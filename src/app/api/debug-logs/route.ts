import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // 1. Get configs
    const { data: configs } = await supabase
      .from('whatsapp_portal_configs')
      .select('*');

    // 2. Get latest webhook payloads
    const { data: payloads } = await supabase
      .from('webhook_payloads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    // 3. Get latest template messages
    const { data: messages } = await supabase
      .from('whatsapp_portal_messages')
      .select('*')
      .eq('message_type', 'template')
      .order('created_at', { ascending: false })
      .limit(10);

    // 4. Get latest templates
    const { data: templates } = await supabase
      .from('whatsapp_portal_templates')
      .select('*')
      .limit(10);

    return NextResponse.json({
      success: true,
      configs,
      payloads,
      messages,
      templates
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
