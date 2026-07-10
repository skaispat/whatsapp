-- Enable RLS on all relevant tables
ALTER TABLE public.whatsapp_portal_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_portal_template_stats ENABLE ROW LEVEL SECURITY;

-- 1. Contacts
CREATE POLICY "Users can manage their own contacts" ON public.whatsapp_portal_contacts
  FOR ALL USING (auth.uid() = user_id);

-- 2. Conversations
CREATE POLICY "Users can manage their own conversations" ON public.whatsapp_portal_conversations
  FOR ALL USING (auth.uid() = user_id);

-- 3. Templates
CREATE POLICY "Users can manage their own templates" ON public.whatsapp_portal_templates
  FOR ALL USING (auth.uid() = user_id);

-- 4. Messages
CREATE POLICY "Users can manage their own messages" ON public.whatsapp_portal_messages
  FOR ALL USING (auth.uid() = user_id);

-- 5. Configs
CREATE POLICY "Users can manage their own configs" ON public.whatsapp_portal_configs
  FOR ALL USING (auth.uid() = user_id);

-- 6. Pricing
CREATE POLICY "Users can manage their own pricing" ON public.whatsapp_portal_pricing
  FOR ALL USING (auth.uid() = user_id);

-- 7. Template Stats
CREATE POLICY "Users can manage their own template stats" ON public.whatsapp_portal_template_stats
  FOR ALL USING (auth.uid() = user_id);

-- 8. Message Events
-- Because message_events doesn't have a user_id directly, we check if the parent message belongs to the user
CREATE POLICY "Users can manage events for their own messages" ON public.whatsapp_portal_message_events
  FOR ALL USING (
    message_id IN (
      SELECT id FROM public.whatsapp_portal_messages WHERE user_id = auth.uid()
    )
  );

-- 9. Views (Views don't need RLS policies directly in Supabase if they query RLS-enabled tables securely)
