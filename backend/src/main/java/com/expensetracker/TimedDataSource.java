package com.expensetracker;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/**
 * 包住連線池的 DataSource，量測「取得連線」與「執行 SQL」各花多少時間（P0 效能排查用）。
 *
 * <p>只計時，不改變任何行為：所有呼叫都原封不動轉給 Hikari 的連線與 Statement。
 * SQL 時間只含 execute*（送出到資料庫回應），不含讀取 ResultSet 的時間。
 */
final class TimedDataSource extends DelegatingDataSource {
    TimedDataSource(DataSource target) {
        super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
        long start = System.nanoTime();
        Connection connection = super.getConnection();
        RequestTiming.addCheckout(System.nanoTime() - start);
        return wrap(connection);
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        long start = System.nanoTime();
        Connection connection = super.getConnection(username, password);
        RequestTiming.addCheckout(System.nanoTime() - start);
        return wrap(connection);
    }

    static Connection wrap(Connection connection) {
        return (Connection) Proxy.newProxyInstance(TimedDataSource.class.getClassLoader(),
            new Class<?>[] { Connection.class }, new ConnectionHandler(connection));
    }

    /** equals／hashCode 以 proxy 本身為準，Spring 交易管理用同一個 proxy 實例比對連線 */
    private abstract static class Forwarding implements InvocationHandler {
        final Object target;

        Forwarding(Object target) {
            this.target = target;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            switch (method.getName()) {
                case "equals":
                    return proxy == args[0];
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "toString":
                    return "Timed(" + target + ")";
                default:
                    return handle(method, args);
            }
        }

        abstract Object handle(Method method, Object[] args) throws Throwable;

        Object forward(Method method, Object[] args) throws Throwable {
            try {
                return method.invoke(target, args);
            } catch (InvocationTargetException exception) {
                throw exception.getCause();
            }
        }
    }

    private static final class ConnectionHandler extends Forwarding {
        ConnectionHandler(Connection target) {
            super(target);
        }

        @Override
        Object handle(Method method, Object[] args) throws Throwable {
            Object result = forward(method, args);
            if (result instanceof Statement statement && method.getReturnType().isInterface()
                    && Statement.class.isAssignableFrom(method.getReturnType())) {
                return Proxy.newProxyInstance(TimedDataSource.class.getClassLoader(),
                    new Class<?>[] { method.getReturnType() }, new StatementHandler(statement));
            }
            return result;
        }
    }

    private static final class StatementHandler extends Forwarding {
        StatementHandler(Statement target) {
            super(target);
        }

        @Override
        Object handle(Method method, Object[] args) throws Throwable {
            if (!method.getName().startsWith("execute")) return forward(method, args);
            long start = System.nanoTime();
            try {
                return forward(method, args);
            } finally {
                RequestTiming.addSql(System.nanoTime() - start);
            }
        }
    }
}
