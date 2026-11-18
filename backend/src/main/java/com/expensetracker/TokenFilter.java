package com.expensetracker;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class TokenFilter extends OncePerRequestFilter {
    private final AuthService auth;

    TokenFilter(AuthService auth) {
        this.auth = auth;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            var user = auth.findUserForToken(header.substring(7));
            if (user != null) {
                // principal 仍是會員編號（Long）；管理員多一個 ROLE_SUPER_ADMIN，/api/admin/** 依此驗證
                var authorities = user.superAdmin()
                    ? List.of(new SimpleGrantedAuthority("ROLE_" + AuthService.SUPER_ADMIN))
                    : List.<SimpleGrantedAuthority>of();
                SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(user.userSeq(), null, authorities));
            }
        }
        chain.doFilter(request, response);
    }
}
