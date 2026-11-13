package com.expensetracker;

import jakarta.mail.internet.InternetAddress;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

/**
 * 寄送驗證碼與通知信。用環境變數設定 SMTP（例如 Gmail 應用程式密碼）：
 * SMTP_HOST、SMTP_PORT、SMTP_USERNAME、SMTP_PASSWORD、MAIL_FROM。
 * 沒有設定 SMTP_HOST 時 Email 驗證停用，註冊維持原本的方式。
 * MAIL_MODE=log 只給自動化測試用：不寄信，把內容寫到日誌。
 */
@Service
public class MailService {
    private static final Logger log = LoggerFactory.getLogger(MailService.class);
    private final JavaMailSenderImpl sender;
    private final String from;
    private final boolean logOnly;

    MailService(@Value("${SMTP_HOST:}") String host,
                @Value("${SMTP_PORT:587}") int port,
                @Value("${SMTP_USERNAME:}") String username,
                @Value("${SMTP_PASSWORD:}") String password,
                @Value("${MAIL_FROM:}") String from,
                @Value("${MAIL_MODE:smtp}") String mode) {
        this.logOnly = "log".equalsIgnoreCase(mode);
        this.from = from.isBlank() ? username : from;
        if (host.isBlank()) {
            this.sender = null;
            return;
        }
        JavaMailSenderImpl impl = new JavaMailSenderImpl();
        impl.setHost(host);
        impl.setPort(port);
        impl.setDefaultEncoding(StandardCharsets.UTF_8.name());
        Properties props = impl.getJavaMailProperties();
        if (!username.isBlank()) {
            impl.setUsername(username);
            impl.setPassword(password);
            props.put("mail.smtp.auth", "true");
        }
        boolean implicitTls = port == 465;
        props.put("mail.smtp.ssl.enable", String.valueOf(implicitTls));
        props.put("mail.smtp.starttls.enable", String.valueOf(!implicitTls && !username.isBlank()));
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");
        this.sender = impl;
    }

    boolean enabled() {
        return logOnly || sender != null;
    }

    void send(String to, String subject, String text, String html) {
        if (logOnly) {
            log.info("[MAIL_MODE=log] to={} subject={} body={}", to, subject, text.replace('\n', ' '));
            return;
        }
        if (sender == null) throw new IllegalStateException("Email 服務尚未設定");
        try {
            var message = sender.createMimeMessage();
            var helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(new InternetAddress(from, "WORK & SAVE 記帳", StandardCharsets.UTF_8.name()));
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(text, html);
            sender.send(message);
        } catch (Exception exception) {
            // 不把 SMTP 細節回給前端；只記錄種類方便排查
            log.warn("寄信失敗：{}", exception.getClass().getSimpleName());
            throw new IllegalStateException("寄信失敗", exception);
        }
    }

    static String codeHtml(String title, String intro, String code, String footer) {
        return """
            <div style="font-family:-apple-system,'Segoe UI','PingFang TC','Microsoft JhengHei',sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#102a43">
              <p style="margin:0;color:#1268da;font-size:12px;font-weight:800;letter-spacing:.08em">WORK &amp; SAVE</p>
              <h1 style="margin:6px 0 12px;font-size:22px">%s</h1>
              <p style="margin:0 0 20px;color:#5e6e82;font-size:15px;line-height:1.6">%s</p>
              <div style="padding:18px;border-radius:14px;background:#eef5fe;text-align:center;font-size:34px;font-weight:800;letter-spacing:.3em;color:#1268da">%s</div>
              <p style="margin:20px 0 0;color:#5e6e82;font-size:13px;line-height:1.6">%s</p>
            </div>
            """.formatted(title, intro, code, footer);
    }

    static String welcomeHtml(String email) {
        return """
            <div style="font-family:-apple-system,'Segoe UI','PingFang TC','Microsoft JhengHei',sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#102a43">
              <p style="margin:0;color:#1268da;font-size:12px;font-weight:800;letter-spacing:.08em">WORK &amp; SAVE</p>
              <h1 style="margin:6px 0 12px;font-size:22px">歡迎加入 🎉</h1>
              <p style="margin:0 0 12px;color:#5e6e82;font-size:15px;line-height:1.6">你的帳號 <strong style="color:#102a43">%s</strong> 已經建立完成。</p>
              <p style="margin:0 0 12px;color:#5e6e82;font-size:15px;line-height:1.6">建議第一步：上傳一張 Payslip，App 會自動設定你的時薪與加給，接著選好班別，就能一鍵排班、預估每週實領。</p>
              <p style="margin:20px 0 0;color:#5e6e82;font-size:13px">如果這不是你本人操作，請忽略這封信。</p>
            </div>
            """.formatted(email);
    }
}
