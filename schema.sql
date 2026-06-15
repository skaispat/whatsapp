CREATE TABLE public.whatsapp_portal_contacts (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NULL,
  phone_number text NOT NULL,
  name text NULL,
  profile_name text NULL,
  created_at timestamp WITH TIME ZONE NULL DEFAULT now(),

  CONSTRAINT whatsapp_portal_contacts_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_contacts_user_id_phone_number_key
    UNIQUE (user_id, phone_number),

  CONSTRAINT whatsapp_portal_contacts_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_contacts_user_id
ON public.whatsapp_portal_contacts
USING btree (user_id)
TABLESPACE pg_default;

CREATE TABLE public.whatsapp_portal_conversations (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NULL,
  contact_id uuid NULL,
  last_message text NULL,
  last_message_at timestamp WITH TIME ZONE NULL,
  unread_count integer NULL DEFAULT 0,
  created_at timestamp WITH TIME ZONE NULL DEFAULT now(),

  CONSTRAINT whatsapp_portal_conversations_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_conversations_user_id_contact_id_key
    UNIQUE (user_id, contact_id),

  CONSTRAINT whatsapp_portal_conversations_contact_id_fkey
    FOREIGN KEY (contact_id)
    REFERENCES public.whatsapp_portal_contacts (id)
    ON DELETE CASCADE,

  CONSTRAINT whatsapp_portal_conversations_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_conversations_user_id
ON public.whatsapp_portal_conversations
USING btree (user_id)
TABLESPACE pg_default;


create view public.whatsapp_portal_debug_inbox_messages as
select
  m.id,
  m.content,
  m.direction,
  m.status,
  m.created_at,
  c.id as conversation_id,
  ct.phone_number,
  ct.name
from
  whatsapp_portal_messages m
  left join whatsapp_portal_conversations c on m.conversation_id = c.id
  left join whatsapp_portal_contacts ct on c.contact_id = ct.id
order by
  m.created_at desc;

CREATE TABLE public.whatsapp_portal_messages (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NULL,
  conversation_id uuid NULL,
  wa_message_id text NULL,
  direction text NULL,
  content text NULL,
  message_type text NULL DEFAULT 'text',
  status text NULL DEFAULT 'sent',
  delivered_at timestamp WITH TIME ZONE NULL,
  seen_at timestamp WITH TIME ZONE NULL,
  created_at timestamp WITH TIME ZONE NULL DEFAULT now(),
  metadata jsonb NULL,
  template_id uuid NULL,
  template_name text NULL,
  pricing_category text NULL,
  conversation_category text NULL,
  media_url text NULL,
  file_name text NULL,
  mime_type text NULL,
  file_size bigint NULL,
  reactions jsonb NULL DEFAULT '[]'::jsonb,
  media jsonb NULL DEFAULT '[]'::jsonb,
  source text NULL DEFAULT 'internal',

  CONSTRAINT whatsapp_portal_messages_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_messages_wa_message_id_key
    UNIQUE (wa_message_id),

  CONSTRAINT whatsapp_portal_messages_conversation_id_fkey
    FOREIGN KEY (conversation_id)
    REFERENCES public.whatsapp_portal_conversations (id)
    ON DELETE CASCADE,

  CONSTRAINT whatsapp_portal_messages_template_id_fkey
    FOREIGN KEY (template_id)
    REFERENCES public.whatsapp_portal_templates (id),

  CONSTRAINT whatsapp_portal_messages_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE,

  CONSTRAINT whatsapp_portal_messages_direction_check
    CHECK (
      direction = ANY (
        ARRAY['inbound'::text, 'outbound'::text]
      )
    )
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_messages_template_id
ON public.whatsapp_portal_messages (template_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_messages_wa_message_id
ON public.whatsapp_portal_messages (wa_message_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_messages_user_id
ON public.whatsapp_portal_messages (user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_messages_conversation_id
ON public.whatsapp_portal_messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_messages_direction_user
ON public.whatsapp_portal_messages (user_id, direction, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_messages_template_name_ilike
ON public.whatsapp_portal_messages (lower(template_name));


CREATE TABLE public.whatsapp_portal_configs (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NULL,
  phone_number_id text NOT NULL,
  waba_id text NOT NULL,
  access_token text NOT NULL,
  webhook_verify_token text NOT NULL,
  is_active boolean NULL DEFAULT true,
  created_at timestamp WITH TIME ZONE NULL DEFAULT now(),

  CONSTRAINT whatsapp_portal_configs_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_configs_user_id_key
    UNIQUE (user_id),

  CONSTRAINT whatsapp_portal_configs_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
) TABLESPACE pg_default;


CREATE TABLE public.whatsapp_portal_message_events (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  message_id uuid NULL,
  wa_message_id text NULL,
  status text NULL,
  event_time timestamp WITH TIME ZONE NULL,
  conversation_id text NULL,
  billable boolean NULL,
  created_at timestamp WITH TIME ZONE NULL DEFAULT now(),

  CONSTRAINT whatsapp_portal_message_events_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_message_events_message_id_fkey
    FOREIGN KEY (message_id)
    REFERENCES public.whatsapp_portal_messages (id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_message_events_wa_message_id
ON public.whatsapp_portal_message_events (wa_message_id);

CREATE TABLE public.whatsapp_portal_pricing (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  category text NULL,
  price_per_conversation numeric NULL,
  created_at timestamp WITH TIME ZONE NULL DEFAULT now(),
  user_id uuid NULL,

  CONSTRAINT whatsapp_portal_pricing_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_pricing_user_cat_key
    UNIQUE (user_id, category),

  CONSTRAINT whatsapp_portal_pricing_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
) TABLESPACE pg_default;


CREATE TABLE public.whatsapp_portal_template_stats (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  template_id uuid NULL,
  user_id uuid NULL,
  sent_count integer NULL DEFAULT 0,
  delivered_count integer NULL DEFAULT 0,
  read_count integer NULL DEFAULT 0,
  failed_count integer NULL DEFAULT 0,
  replied_count integer NULL DEFAULT 0,
  total_cost numeric NULL DEFAULT 0,
  updated_at timestamp WITH TIME ZONE NULL DEFAULT now(),

  CONSTRAINT whatsapp_portal_template_stats_pkey
    PRIMARY KEY (id),

  CONSTRAINT whatsapp_portal_template_stats_user_template_unique
    UNIQUE (user_id, template_id),

  CONSTRAINT whatsapp_portal_template_stats_template_id_fkey
    FOREIGN KEY (template_id)
    REFERENCES public.whatsapp_portal_templates (id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_template_stats_template
ON public.whatsapp_portal_template_stats (template_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_template_stats_lookup
ON public.whatsapp_portal_template_stats (template_id, user_id);


create table public.whatsapp_portal_templates (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid null,
  template_name text not null,
  category text null,
  language text null,
  status text null,
  created_at timestamp with time zone null default now(),
  body text null,
  header text null,
  footer text null,
  buttons jsonb null default '[]'::jsonb,
  constraint whatsapp_portal_templates_pkey primary key (id),
  constraint whatsapp_portal_templates_user_template_unique unique (user_id, template_name),
  constraint whatsapp_portal_templates_user_id_fkey foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;



CREATE OR REPLACE VIEW public.debug_inbox_messages AS
SELECT
  m.id,
  m.content,
  m.direction,
  m.status,
  m.created_at,
  c.id AS conversation_id,
  ct.phone_number,
  ct.name
FROM public.whatsapp_portal_messages m
LEFT JOIN public.whatsapp_portal_conversations c
  ON m.conversation_id = c.id
LEFT JOIN public.whatsapp_portal_contacts ct
  ON c.contact_id = ct.id
ORDER BY m.created_at DESC;


CREATE VIEW public.responses AS
SELECT
  m.created_at AS "timestamp",

  CASE
    WHEN m.direction = 'inbound' THEN 'INCOMING_MSG'
    WHEN m.source = 'portal' THEN 'PORTAL_REPLY'
    ELSE 'STATUS_UPDATE'
  END AS event_type,

  m.wa_message_id AS message_id,

  c.phone_number AS from_number,
  COALESCE(c.name, c.profile_name) AS from_name,

  wc.phone_number_id AS to_number,

  COALESCE(
    (
      SELECT UPPER(wme.status)
      FROM public.whatsapp_portal_message_events wme
      WHERE wme.message_id = m.id
      ORDER BY wme.event_time DESC
      LIMIT 1
    ),
    UPPER(m.status)
  ) AS status,

  m.message_type,
  m.content,

  NULL::text AS media_id,
  m.mime_type AS media_type,
  m.media_url,

  wc.phone_number_id AS business_phone,
  wc.phone_number_id,

  conv.id::text AS conversation_id,

  m.pricing_category,

  NULL::text AS error_code,
  NULL::text AS error_message,
  NULL::text AS context_message_id,
  NULL::text AS interactive_type,
  NULL::text AS interactive_id,
  NULL::text AS interactive_title,
  NULL::text AS referred_product,

  CONCAT(
    'TemplateName:',
    COALESCE(wt.template_name, 'Unknown')
  ) AS raw_payload,

  GREATEST(
    m.created_at,
    COALESCE(
      (
        SELECT MAX(wme.event_time)
        FROM public.whatsapp_portal_message_events wme
        WHERE wme.message_id = m.id
      ),
      m.created_at
    )
  ) AS sync_timestamp

FROM public.whatsapp_portal_messages m

LEFT JOIN public.whatsapp_portal_conversations conv
  ON conv.id = m.conversation_id

LEFT JOIN public.whatsapp_portal_contacts c
  ON c.id = conv.contact_id

LEFT JOIN public.whatsapp_portal_templates wt
  ON wt.id = m.template_id

LEFT JOIN public.whatsapp_portal_configs wc
  ON wc.user_id = m.user_id;

CREATE INDEX IF NOT EXISTS idx_whatsapp_portal_message_events_message_time
ON public.whatsapp_portal_message_events (
  message_id,
  event_time DESC
);

  -- 1. Create Raw Webhook payloads table
CREATE TABLE IF NOT EXISTS public.webhook_payloads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and add policy
ALTER TABLE public.webhook_payloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own webhook payloads" ON public.webhook_payloads
  FOR ALL USING (auth.uid() = user_id);

-- 2. Add interactive and analytics tracking columns to messages
ALTER TABLE public.whatsapp_portal_messages ADD COLUMN IF NOT EXISTS interactive_type TEXT;
ALTER TABLE public.whatsapp_portal_messages ADD COLUMN IF NOT EXISTS interactive_id TEXT;
ALTER TABLE public.whatsapp_portal_messages ADD COLUMN IF NOT EXISTS interactive_title TEXT;
ALTER TABLE public.whatsapp_portal_messages ADD COLUMN IF NOT EXISTS context_message_id TEXT;
ALTER TABLE public.whatsapp_portal_messages ADD COLUMN IF NOT EXISTS interest_status TEXT;

-- add footer column to whatsapp_portal_templates
ALTER TABLE public.whatsapp_portal_templates ADD COLUMN IF NOT EXISTS footer text;


-- 3. Add optimal indexes for tracking analytics
CREATE INDEX IF NOT EXISTS idx_messages_interactive_type ON public.whatsapp_portal_messages(interactive_type);
CREATE INDEX IF NOT EXISTS idx_messages_context_message_id ON public.whatsapp_portal_messages(context_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_interest_status ON public.whatsapp_portal_messages(interest_status);
