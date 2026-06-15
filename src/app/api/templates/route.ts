import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchWhatsAppTemplates } from '@/lib/whatsapp';

/**
 * GET /api/templates
 * Fetches all approved WhatsApp templates from Meta's API for the current user.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    const { searchParams } = new URL(request.url);

    // Resolve credentials + real user_id from whatsapp_portal_configs
    const { data: config } = await supabase
      .from('whatsapp_portal_configs')
      .select('user_id, waba_id, access_token')
      .eq('phone_number_id', process.env.WHATSAPP_PHONE_NUMBER_ID!)
      .single();

    if (!config?.waba_id || !config?.access_token || !config?.user_id) {
      return NextResponse.json({ error: 'WhatsApp config not found' }, { status: 400 });
    }

    const activeUserId = config.user_id;

    // 2. Fetch Templates from Meta
    const metaTemplates = await fetchWhatsAppTemplates({
      wabaId: config.waba_id,
      accessToken: config.access_token,
    });

    // 2.5 Sync templates to the local DB table (whatsapp_portal_templates)
    if (metaTemplates && metaTemplates.length > 0) {
      const dbTemplates = metaTemplates.map((t: any) => {
        const buttonsComponent = (t.components || []).find((c: any) => c.type === 'BUTTONS');
        return {
          user_id: activeUserId,
          template_name: t.name,
          category: t.category,
          language: t.language,
          status: t.status,
          body: t.body || '',
          header: t.header || '',
          footer: t.footer || '',
          buttons: buttonsComponent?.buttons || t.buttons || [],
        };
      });

      const { error: syncErr } = await supabase
        .from('whatsapp_portal_templates')
        .upsert(dbTemplates, { onConflict: 'user_id,template_name' });

      if (syncErr) {
        console.error('⚠️ Error syncing templates to database:', syncErr);
      } else {
        console.log(`✅ Synced ${dbTemplates.length} templates to database.`);
      }
    }

    // 3. Fetch Message Stats from Database
    // We group by template_name to get counts
    const { data: messages, error: msgErr } = await supabase
      .from('whatsapp_portal_messages')
      .select('status, template_name, direction')
      .eq('user_id', activeUserId)
      .eq('message_type', 'template');

    if (msgErr) throw msgErr;

    // 4. Aggregate Stats
    const statsMap: Record<string, any> = {};
    
    const msgs: { status: string; template_name: string | null; direction: string }[] = (messages as any) || [];
    msgs.forEach(msg => {
      const name = msg.template_name || 'unknown';
      if (!statsMap[name]) {
        statsMap[name] = { sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 };
      }

      const s = statsMap[name];
      if (msg.direction === 'outbound') {
        if (['sent', 'delivered', 'read'].includes(msg.status)) s.sent++;
        if (['delivered', 'read'].includes(msg.status)) s.delivered++;
        if (msg.status === 'read') s.read++;
        if (msg.status === 'failed') s.failed++;
      }
    });

    // 5. Merge Meta Data with DB Stats
    const templates = metaTemplates.map(t => {
      const s = statsMap[t.name] || { sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 };
      
      const deliveryRate = s.sent > 0 ? Math.round((s.delivered / s.sent) * 100) : 0;
      const readRate     = s.sent > 0 ? Math.round((s.read / s.sent) * 100) : 0;
      const replyRate    = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;

      return {
        ...t,
        sent: s.sent,
        delivered: s.delivered,
        read: s.read,
        failed: s.failed,
        replied: s.replied,
        deliveryRate,
        readRate,
        replyRate
      };
    });

    return NextResponse.json({ templates });

  } catch (err: any) {
    console.error('Fetch templates error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}
