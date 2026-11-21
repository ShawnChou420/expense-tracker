package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class SupermarketCsvTest {
    static final String HEADER = "external_product_id,name,brand,package_size,category,regular_price,sale_price,"
        + "unit_price,promotion_type,promotion_start,promotion_end,product_url\n";

    @Test
    void parsesPricesToCentsAndKeepsUnknownFieldsNull() {
        var result = SupermarketCsv.parse(HEADER
            + "123,\"Tim Tam, Original\",Arnott's,200g,Biscuits,$5.00,2.50,$1.25 / 100g,half_price,2026-11-19,2026-11-25,\n"
            + "456,Milk,,,,,3.1,,,2026-11-19,2026-11-25,\n");
        assertEquals(List.of(), result.errors());
        assertEquals(2, result.rows().size());
        var first = result.rows().getFirst();
        assertEquals("Tim Tam, Original", first.name());
        assertEquals(500, first.regularPriceCents());
        assertEquals(250, first.salePriceCents());
        assertEquals("HALF_PRICE", first.promotionType());
        assertEquals(LocalDate.of(2026, 11, 25), first.promotionEnd());
        var second = result.rows().get(1);
        assertNull(second.brand());
        assertNull(second.regularPriceCents());
        assertEquals(310, second.salePriceCents());
        assertEquals("OTHER", second.promotionType());
    }

    @Test
    void rejectsBadRowsWithoutDroppingGoodOnes() {
        var result = SupermarketCsv.parse(HEADER
            + "1,Good,,,,4,2,,,2026-11-19,2026-11-25,\n"
            + "2,Sale above regular,,,,2,4,,,2026-11-19,2026-11-25,\n"
            + "3,Three decimals,,,,,1.999,,,2026-11-19,2026-11-25,\n"
            + "4,Ends before start,,,,,1,,,2026-11-25,2026-11-19,\n"
            + "5,Bad type,,,,,1,,BOGO,2026-11-19,2026-11-25,\n"
            + "6,Foreign link,,,,,1,,,2026-11-19,2026-11-25,https://example.com/x\n"
            + "1,Duplicate period,,,,,1,,,2026-11-19,2026-11-25,\n"
            + ",Missing id,,,,,1,,,2026-11-19,2026-11-25,\n");
        assertEquals(1, result.rows().size());
        assertEquals(8, result.rowCount());
        assertEquals(7, result.errors().size());
        assertTrue(result.errors().getFirst().startsWith("第 3 列"));
    }

    @Test
    void sameProductDifferentSizeIsSeparateRow() {
        var result = SupermarketCsv.parse(HEADER
            + "100,Coke,,375ml,,,1,,,2026-11-19,2026-11-25,\n"
            + "101,Coke,,1.25L,,,2,,,2026-11-19,2026-11-25,\n");
        assertEquals(2, result.rows().size());
    }

    @Test
    void reportsMissingRequiredColumns() {
        var result = SupermarketCsv.parse("name,sale_price\nMilk,1\n");
        assertTrue(result.rows().isEmpty());
        assertTrue(result.errors().contains("缺少必要欄位：external_product_id"));
    }

    @Test
    void handlesBomQuotesAndCrlf() {
        var records = SupermarketCsv.records("﻿a,b\r\n\"x \"\"y\"\"\",\"line\nbreak\"\r\n".replace("﻿", ""));
        assertEquals(List.of("a", "b"), records.get(0));
        assertEquals(List.of("x \"y\"", "line\nbreak"), records.get(1));
    }
}
