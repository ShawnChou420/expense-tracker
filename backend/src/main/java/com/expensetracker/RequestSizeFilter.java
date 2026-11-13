package com.expensetracker;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 限制單一請求大小，避免有人塞超大 JSON 把免費資料庫空間用光。
 * 最大的正常請求是薪資單匯入（明細上限 20,000 字），256 KB 綽綽有餘。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestSizeFilter extends OncePerRequestFilter {
    static final long MAX_BODY_BYTES = 256 * 1024;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        long length = request.getContentLengthLong();
        // 沒有 Content-Length（分段傳送）的寫入請求也拒絕，正常前端都會帶長度
        boolean writes = !"GET".equals(request.getMethod()) && !"OPTIONS".equals(request.getMethod())
            && !"HEAD".equals(request.getMethod());
        boolean chunked = length < 0 && request.getHeader("Transfer-Encoding") != null;
        if (length > MAX_BODY_BYTES || (writes && chunked)) {
            response.setStatus(413);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"detail\":\"資料太大\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
