package com.expensetracker;

import jakarta.servlet.DispatcherType;
import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    UserDetailsService userDetailsService() {
        return username -> { throw new UsernameNotFoundException("Use bearer authentication"); };
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, TokenFilter tokenFilter, ActivityLog activity) throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable) // Authorization header only; no ambient browser credentials.
            .cors(Customizer.withDefaults())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .formLogin(AbstractHttpConfigurer::disable)
            .httpBasic(AbstractHttpConfigurer::disable)
            .exceptionHandling(errors -> errors
                .authenticationEntryPoint(
                    (request, response, exception) -> response.sendError(HttpStatus.UNAUTHORIZED.value()))
                // 一般會員打管理 API：拒絕並記一筆管理員安全事件（不含請求內容）
                .accessDeniedHandler((request, response, exception) -> {
                    var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
                    Long seq = auth != null && auth.getPrincipal() instanceof Long value ? value : null;
                    activity.failure(seq, "ADMIN_SECURITY", "ADMIN_ACCESS_DENIED", "NOT_SUPER_ADMIN",
                        java.util.Map.of("method", request.getMethod()));
                    response.sendError(HttpStatus.FORBIDDEN.value());
                }))
            .authorizeHttpRequests(auth -> auth
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login",
                    "/api/auth/email-code", "/api/auth/reset-password").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/auth/config").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/health").permitAll() // Render 健康檢查
                .requestMatchers(HttpMethod.GET, "/api/ready").permitAll() // App 開啟時等待後端與資料庫就緒
                // 訪客首頁的每日小語：只讀共用語錄，依日期固定一句，不寫資料庫
                .requestMatchers(HttpMethod.GET, "/api/daily-quotes/sample").permitAll()
                // 管理後台：每個請求都依登入 token 重新查角色（TokenFilter），不是 SUPER_ADMIN 一律 403
                .requestMatchers("/api/admin/**").hasRole(AuthService.SUPER_ADMIN)
                .anyRequest().authenticated())
            .addFilterBefore(tokenFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${app.cors-origins}") String origins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.stream(origins.split(",")).map(String::trim).toList());
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(Arrays.asList("Authorization", "Content-Type", "X-Request-Id"));
        config.setAllowCredentials(false);
        // 量測期間讓前端讀得到伺服器端耗時拆解（見 RequestTimingFilter，預設不送出此標頭）
        config.setExposedHeaders(Arrays.asList("Server-Timing", "X-Request-Id"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
