-- The inspected legacy salary_setting_info table is empty; each new member has one rate set.
CREATE UNIQUE INDEX uq_salary_settings_owner ON salary_setting_info(user_seq);
