-- public.user_info definition

-- Drop table

-- DROP TABLE public.user_info;

CREATE TABLE public.user_info (
	seq bigserial NOT NULL,
	user_id varchar(50) NOT NULL,
	password_hash varchar(255) NOT NULL,
	create_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_time timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	update_user varchar(50) NULL,
	email varchar(100) NULL,
	nickname varchar(50) NULL,
	phone varchar(20) NULL,
	visa_type varchar(30) NULL,
	visa_expiry_date date NULL,
	target_savings numeric(12, 2) DEFAULT 0 NULL,
	CONSTRAINT user_info_pkey PRIMARY KEY (seq),
	CONSTRAINT user_info_user_id_key UNIQUE (user_id)
);

-- Table Triggers

create trigger trg_user_info_upd before
update
    on
    public.user_info for each row execute function update_modified_column();