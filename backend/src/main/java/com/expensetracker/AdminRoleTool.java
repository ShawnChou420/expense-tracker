package com.expensetracker;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;

/**
 * 受控的 SUPER_ADMIN 初始化／撤銷工具（指令列，不是 API）。只在擁有者自己的電腦上執行：
 *
 * <pre>
 *   # 連線資訊用環境變數提供，不寫進程式或 Git（DB_URL＋DB_USER＋DB_PASSWORD，或 DATABASE_URL）
 *   bash backend/gradlew adminRole --args="find owner@example.com"   # 查自己的 user_seq（唯讀）
 *   bash backend/gradlew adminRole --args="list"
 *   bash backend/gradlew adminRole --args="grant 12 --reason 初始化擁有者帳號"
 *   bash backend/gradlew adminRole --args="revoke 12 --reason 不再擔任管理員"
 * </pre>
 *
 * - 以內部 user_seq 授權；執行前會顯示該會員 Email，必須輸入同一個 Email 確認
 *   （自動化測試可加 --confirm-email 提供）。
 * - 可重複執行：已經是管理員就不重複新增。
 * - 撤銷時保護最後一位 SUPER_ADMIN。
 * - 每次授權／撤銷都寫入 admin_audit_log（admin_seq 為空、details.via = CLI）。
 */
public final class AdminRoleTool {
    private AdminRoleTool() {}

    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            usage();
            return;
        }
        Map<String, String> env = System.getenv();
        String url = env.get("DB_URL");
        String user = env.get("DB_USER");
        String password = env.getOrDefault("DB_PASSWORD", "");
        if (url == null || url.isBlank()) {
            Map<String, String> fromCloud = DatabaseUrl.springProperties(env);
            url = fromCloud.get("spring.datasource.url");
            user = fromCloud.get("spring.datasource.username");
            password = fromCloud.getOrDefault("spring.datasource.password", "");
        }
        if (url == null) throw new IllegalStateException("請設定 DB_URL／DB_USER（或 DATABASE_URL）環境變數");
        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            switch (args[0]) {
                case "list" -> list(connection);
                case "find" -> find(connection, args);
                case "grant", "revoke" -> change(connection, args);
                default -> usage();
            }
        }
    }

    private static void usage() {
        System.out.println("""
            用法：
              find   <email>                         查詢會員的 user_seq（唯讀）
              list                                   列出目前的 SUPER_ADMIN
              grant  <user_seq> --reason <原因>      授予 SUPER_ADMIN（會要求輸入該會員 Email 確認）
              revoke <user_seq> --reason <原因>      撤銷 SUPER_ADMIN（最後一位不能撤銷）
            """);
    }

    private static void list(Connection connection) throws SQLException {
        try (var statement = connection.prepareStatement("""
                SELECT u.seq, u.email_normalized, u.account_status, r.granted_at
                FROM user_role r JOIN user_info u ON u.seq = r.user_seq
                WHERE r.role = 'SUPER_ADMIN' ORDER BY r.granted_at
                """);
             var rows = statement.executeQuery()) {
            int count = 0;
            while (rows.next()) {
                count++;
                System.out.printf("user_seq=%d  %s  %s  授予於 %s%n", rows.getLong(1), rows.getString(2),
                    rows.getString(3), rows.getTimestamp(4).toInstant());
            }
            if (count == 0) System.out.println("目前沒有 SUPER_ADMIN");
        }
    }

    private static void find(Connection connection, String[] args) throws SQLException {
        if (args.length < 2) throw new IllegalArgumentException("請提供 Email");
        try (var statement = connection.prepareStatement(
                "SELECT seq, account_status FROM user_info WHERE email_normalized = ?")) {
            statement.setString(1, AuthService.normalizeEmail(args[1]));
            try (var rows = statement.executeQuery()) {
                if (rows.next()) System.out.printf("user_seq=%d  狀態 %s%n", rows.getLong(1), rows.getString(2));
                else System.out.println("找不到這個 Email");
            }
        }
    }

    static String option(String[] args, String name) {
        for (int i = 0; i < args.length - 1; i++) if (args[i].equals(name)) return args[i + 1];
        return null;
    }

    private static void change(Connection connection, String[] args) throws Exception {
        boolean grant = args[0].equals("grant");
        if (args.length < 2 || !args[1].matches("\\d{1,18}")) throw new IllegalArgumentException("請提供 user_seq（數字）");
        long seq = Long.parseLong(args[1]);
        String reason = AdminService.requireReason(option(args, "--reason"));

        String email;
        String status;
        try (var statement = connection.prepareStatement("SELECT email_normalized, account_status FROM user_info WHERE seq = ?")) {
            statement.setLong(1, seq);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) throw new IllegalArgumentException("找不到 user_seq=" + seq);
                email = rows.getString(1);
                status = rows.getString(2);
            }
        }
        System.out.printf("目標會員：user_seq=%d  %s  狀態 %s%n", seq, email, status);
        if (grant && !"ACTIVE".equals(status)) throw new IllegalStateException("停用中的帳號不能授予管理員");

        String confirm = option(args, "--confirm-email");
        if (confirm == null) {
            System.out.print("請輸入這位會員的 Email 確認" + (grant ? "授予" : "撤銷") + " SUPER_ADMIN：");
            confirm = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
        }
        if (confirm == null || !AuthService.normalizeEmail(confirm).equals(email)) {
            System.out.println("Email 不一致，已取消，沒有任何變更。");
            return;
        }

        connection.setAutoCommit(false);
        try {
            if (grant) {
                try (var statement = connection.prepareStatement(
                        "INSERT INTO user_role(user_seq, role) VALUES (?, 'SUPER_ADMIN') ON CONFLICT DO NOTHING")) {
                    statement.setLong(1, seq);
                    if (statement.executeUpdate() == 0) System.out.println("這位會員已經是 SUPER_ADMIN，沒有變更。");
                }
            } else {
                try (var statement = connection.prepareStatement(
                        "SELECT count(*) FROM user_role WHERE role = 'SUPER_ADMIN' AND user_seq <> ?")) {
                    statement.setLong(1, seq);
                    try (var rows = statement.executeQuery()) {
                        rows.next();
                        if (rows.getLong(1) == 0) throw new IllegalStateException("這是最後一位 SUPER_ADMIN，不能撤銷");
                    }
                }
                try (var statement = connection.prepareStatement(
                        "DELETE FROM user_role WHERE user_seq = ? AND role = 'SUPER_ADMIN'")) {
                    statement.setLong(1, seq);
                    statement.executeUpdate();
                }
            }
            try (var statement = connection.prepareStatement("""
                    INSERT INTO admin_audit_log(admin_seq, target_seq, action, reason, result, details)
                    VALUES (NULL, ?, ?, ?, 'SUCCESS', '{"via":"CLI"}'::jsonb)
                    """)) {
                statement.setLong(1, seq);
                statement.setString(2, grant ? "GRANT_SUPER_ADMIN" : "REVOKE_SUPER_ADMIN");
                statement.setString(3, reason);
                statement.executeUpdate();
            }
            connection.commit();
        } catch (Exception exception) {
            connection.rollback();
            throw exception;
        }
        System.out.println("完成。目前的 SUPER_ADMIN：");
        list(connection);
    }
}
