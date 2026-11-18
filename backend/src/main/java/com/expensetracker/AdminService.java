package com.expensetracker;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Super Admin 的會員管理操作。每個操作（成功或失敗）都寫入 admin_audit_log：
 * 管理員、目標會員、時間、原因、結果。稽核紀錄只能新增，沒有修改或刪除的 API（資料庫也有 trigger 保護）。
 *
 * <p>規則：
 * - 原因必填（5–500 字）。
 * - 停用、恢復、角色異動、刪除需要再次輸入管理員自己的密碼。
 * - 不能停用或刪除自己；最後一位 SUPER_ADMIN 不能被降權、停用或刪除。
 */
@Service
public class AdminService {
    static final int REASON_MIN = 5;
    static final int REASON_MAX = 500;

    private final JdbcTemplate db;
    private final AuthService auth;
    private final ObjectMapper json;
    private final TransactionTemplate separate;

    AdminService(JdbcTemplate db, AuthService auth, ObjectMapper json, PlatformTransactionManager transactions) {
        this.db = db;
        this.auth = auth;
        this.json = json;
        this.separate = new TransactionTemplate(transactions);
        this.separate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    static String requireReason(String reason) {
        String trimmed = reason == null ? "" : reason.strip();
        if (trimmed.length() < REASON_MIN || trimmed.length() > REASON_MAX)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請填寫原因（" + REASON_MIN + "–" + REASON_MAX + " 字）");
        return trimmed;
    }

    /** 稽核紀錄用獨立交易寫入：操作失敗回滾時，失敗的紀錄仍會留下 */
    void audit(Long adminSeq, Long targetSeq, String action, String reason, boolean ok, Map<String, ?> details) {
        String detailJson = json.writeValueAsString(ActivityLog.sanitize(details));
        separate.executeWithoutResult(status -> db.update("""
            INSERT INTO admin_audit_log(admin_seq, target_seq, action, reason, result, details, request_id)
            VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)
            """, adminSeq, targetSeq, action, reason == null || reason.isBlank() ? "（未提供）" : reason,
            ok ? "SUCCESS" : "FAILURE", detailJson, RequestTiming.currentRequestId()));
    }

    /** 包住一個管理操作：成功或失敗都寫稽核紀錄，失敗原因用簡短代碼記錄 */
    <T> T audited(long adminSeq, long targetSeq, String action, String reason, Map<String, ?> details,
                  java.util.function.Supplier<T> operation) {
        try {
            T result = operation.get();
            audit(adminSeq, targetSeq, action, reason, true, details);
            return result;
        } catch (ResponseStatusException exception) {
            var failed = new java.util.LinkedHashMap<String, Object>(details == null ? Map.of() : details);
            failed.put("status", exception.getStatusCode().value());
            audit(adminSeq, targetSeq, action, reason, false, failed);
            throw exception;
        }
    }

    String requireTargetEmail(long targetSeq) {
        var rows = db.queryForList("SELECT email_normalized FROM user_info WHERE seq = ?", String.class, targetSeq);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這位會員");
        return rows.get(0);
    }

    // ---------- 操作 ----------

    @Transactional
    public void updateNickname(long adminSeq, long targetSeq, String nickname, String reason) {
        String why = requireReason(reason);
        audited(adminSeq, targetSeq, "EDIT_PROFILE", why, Map.of("field", "nickname"), () -> {
            requireTargetEmail(targetSeq);
            auth.updateNickname(targetSeq, AccountController.normalizeNickname(nickname));
            return null;
        });
    }

    @Transactional
    public void setStatus(long adminSeq, long targetSeq, boolean active, String reason, String password) {
        String why = requireReason(reason);
        audited(adminSeq, targetSeq, active ? "ENABLE_USER" : "DISABLE_USER", why, null, () -> {
            auth.reauthenticate(adminSeq, password);
            requireTargetEmail(targetSeq);
            if (!active && adminSeq == targetSeq)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能停用自己的帳號");
            if (!active && auth.isLastSuperAdmin(targetSeq))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能停用最後一位管理員");
            db.update("UPDATE user_info SET account_status = ?, status_changed_at = now(), update_time = now() WHERE seq = ?",
                active ? "ACTIVE" : "DISABLED", targetSeq);
            // 停用時所有登入立即失效
            if (!active)
                db.update("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND revoked_at IS NULL", targetSeq);
            return null;
        });
    }

    @Transactional
    public void setSuperAdmin(long adminSeq, long targetSeq, boolean grant, String reason, String password) {
        String why = requireReason(reason);
        audited(adminSeq, targetSeq, grant ? "GRANT_SUPER_ADMIN" : "REVOKE_SUPER_ADMIN", why, null, () -> {
            auth.reauthenticate(adminSeq, password);
            requireTargetEmail(targetSeq);
            if (grant) {
                Integer active = db.queryForObject(
                    "SELECT count(*) FROM user_info WHERE seq = ? AND account_status = 'ACTIVE'", Integer.class, targetSeq);
                if (active == null || active == 0)
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "停用中的帳號不能授予管理員");
                db.update("INSERT INTO user_role(user_seq, role) VALUES (?, 'SUPER_ADMIN') ON CONFLICT DO NOTHING", targetSeq);
            } else {
                if (auth.isLastSuperAdmin(targetSeq))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能移除最後一位管理員");
                db.update("DELETE FROM user_role WHERE user_seq = ? AND role = 'SUPER_ADMIN'", targetSeq);
            }
            return null;
        });
    }

    @Transactional
    public void deleteUser(long adminSeq, long targetSeq, String reason, String password, String confirmEmail) {
        String why = requireReason(reason);
        audited(adminSeq, targetSeq, "DELETE_USER", why, null, () -> {
            auth.reauthenticate(adminSeq, password);
            String email = requireTargetEmail(targetSeq);
            if (adminSeq == targetSeq)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能在後台刪除自己的帳號");
            if (confirmEmail == null || !AuthService.normalizeEmail(confirmEmail).equals(email))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入這位會員的 Email 確認刪除");
            if (auth.isLastSuperAdmin(targetSeq))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能刪除最後一位管理員");
            auth.deleteAccountData(targetSeq);
            return null;
        });
    }
}
