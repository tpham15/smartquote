# AUTO-GENERATED from supabase/phase8_1_plan_limits_source.sql + supabase/phase10_plan_capabilities.sql.
# SQL remains the source of truth. Do not edit quota/capability values here.

SQL_PLAN_LIMIT_SOURCE = ["supabase/phase8_1_plan_limits_source.sql","supabase/phase10_plan_capabilities.sql"]

PLAN_LIMITS = {
    "free": {
        "quotes_per_month": 3,
        "ai_claude_request": 0,
        "web_scrape": 0,
        "product_enrich": 0,
        "pdf_extract": 0,
        "excel_export": 5
    },
    "trial": {
        "quotes_per_month": -1,
        "ai_claude_request": 200,
        "web_scrape": 20,
        "product_enrich": 30,
        "pdf_extract": 20,
        "excel_export": 100
    },
    "starter": {
        "quotes_per_month": 30,
        "ai_claude_request": 300,
        "web_scrape": 20,
        "product_enrich": 50,
        "pdf_extract": 10,
        "excel_export": 100
    },
    "pro": {
        "quotes_per_month": -1,
        "ai_claude_request": 1500,
        "web_scrape": 100,
        "product_enrich": 250,
        "pdf_extract": 50,
        "excel_export": 1000
    },
    "business": {
        "quotes_per_month": -1,
        "ai_claude_request": 6000,
        "web_scrape": 500,
        "product_enrich": 1000,
        "pdf_extract": 300,
        "excel_export": 5000
    },
    "expired": {
        "quotes_per_month": 0,
        "ai_claude_request": 0,
        "web_scrape": 0,
        "product_enrich": 0,
        "pdf_extract": 0,
        "excel_export": 0
    }
}

PLAN_CAPABILITIES = {
    "free": {
        "ai_import": False,
        "template_memory": False,
        "correction_learning": False,
        "branded_pdf": False,
        "quote_variants_abc": False,
        "bom_import": False,
        "team_seats": False,
        "price_intelligence": False,
        "api_access": False,
        "priority_support": False
    },
    "trial": {
        "ai_import": True,
        "template_memory": True,
        "correction_learning": True,
        "branded_pdf": True,
        "quote_variants_abc": True,
        "bom_import": True,
        "team_seats": True,
        "price_intelligence": False,
        "api_access": False,
        "priority_support": False
    },
    "starter": {
        "ai_import": True,
        "template_memory": True,
        "correction_learning": True,
        "branded_pdf": True,
        "quote_variants_abc": False,
        "bom_import": False,
        "team_seats": False,
        "price_intelligence": False,
        "api_access": False,
        "priority_support": False
    },
    "pro": {
        "ai_import": True,
        "template_memory": True,
        "correction_learning": True,
        "branded_pdf": True,
        "quote_variants_abc": True,
        "bom_import": True,
        "team_seats": True,
        "price_intelligence": False,
        "api_access": False,
        "priority_support": True
    },
    "business": {
        "ai_import": True,
        "template_memory": True,
        "correction_learning": True,
        "branded_pdf": True,
        "quote_variants_abc": True,
        "bom_import": True,
        "team_seats": True,
        "price_intelligence": True,
        "api_access": True,
        "priority_support": True
    },
    "expired": {
        "ai_import": False,
        "template_memory": False,
        "correction_learning": False,
        "branded_pdf": False,
        "quote_variants_abc": False,
        "bom_import": False,
        "team_seats": False,
        "price_intelligence": False,
        "api_access": False,
        "priority_support": False
    }
}
