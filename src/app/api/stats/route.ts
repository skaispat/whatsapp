import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();

    // Resolve real user_id from whatsapp_portal_configs
    const { data: config } = await supabase
      .from('whatsapp_portal_configs')
      .select('user_id')
      .eq('phone_number_id', process.env.WHATSAPP_PHONE_NUMBER_ID!)
      .single();

    if (!config?.user_id) {
      return NextResponse.json({ error: 'WhatsApp config not found' }, { status: 400 });
    }

    const userId = config.user_id;

    // Messages Stats
    const { data: messages, error: messagesErr } = await supabase
      .from('whatsapp_portal_messages')
      .select('status, direction, interactive_type, interest_status')
      .eq('user_id', userId);

    if (messagesErr) throw messagesErr;

    // Profiles 
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    // Fetch 10 most recent interactions
    const { data: recentInteractionsData, error: recentErr } = await supabase
      .from('whatsapp_portal_messages')
      .select(`
        id,
        created_at,
        content,
        direction,
        interactive_type,
        interactive_id,
        interactive_title,
        interest_status,
        whatsapp_portal_conversations (
          id,
          whatsapp_portal_contacts (
            id,
            name,
            profile_name,
            phone_number
          )
        )
      `)
      .eq('user_id', userId)
      .or('interactive_type.not.is.null,direction.eq.inbound')
      .order('created_at', { ascending: false })
      .limit(10);

    const msgs: any[] = (messages as any) || [];
    const outbound = msgs.filter(m => m.direction === 'outbound');
    const repliesCount = msgs.filter(m => m.direction === 'inbound').length;

    let totalInteractions = 0;
    let buttonClicks = 0;
    let listSelections = 0;
    let interestedLeads = 0;
    let notInterestedLeads = 0;

    for (const m of msgs) {
      const hasInteractive = m.interactive_type !== null && m.interactive_type !== undefined;
      const isInbound = m.direction === 'inbound';
      
      if (hasInteractive || isInbound) {
        totalInteractions++;
      }
      
      if (hasInteractive && ['button_reply', 'button'].includes(m.interactive_type)) {
        buttonClicks++;
      }
      
      if (hasInteractive && m.interactive_type === 'list_reply') {
        listSelections++;
      }
      
      if (m.interest_status === 'Interested') {
        interestedLeads++;
      }
      
      if (m.interest_status === 'Not Interested') {
        notInterestedLeads++;
      }
    }

    const stats = {
      sent: outbound.filter(m => ['sent', 'delivered', 'read'].includes(m.status)).length,
      delivered: outbound.filter(m => ['delivered', 'read'].includes(m.status)).length,
      read: outbound.filter(m => m.status === 'read').length,
      failed: outbound.filter(m => m.status === 'failed').length,
      queue: outbound.filter(m => m.status === 'queue').length,
      replies: repliesCount,
      total: msgs.length,
      totalInteractions,
      buttonClicks,
      listSelections,
      interestedLeads,
      notInterestedLeads
    };

    const recentInteractions = (recentInteractionsData || []).map((m: any) => {
      const contact = m.whatsapp_portal_conversations?.whatsapp_portal_contacts;
      return {
        id: m.id,
        created_at: m.created_at,
        content: m.content || '',
        interactive_type: m.interactive_type,
        interactive_id: m.interactive_id,
        interactive_title: m.interactive_title,
        interest_status: m.interest_status || 'Other',
        sender_name: contact?.name || contact?.profile_name || contact?.phone_number || 'Unknown'
      };
    });

    // Calculate hourly data for charts 
    const hourly = [];
    for (let i = 0; i < 24; i++) {
        hourly.push({ hour: `${i}:00`, sent: 0, delivered: 0, read: 0 });
    }
    
    const recentMessages: any[] = [];

    return NextResponse.json({
        stats,
        credits: {
          remaining: profile?.credits || 0,
          used: 10000 - (profile?.credits || 10000), // assumption
          limit: 10000 
        },
        hourly,
        messages: recentMessages,
        recentInteractions
    });

  } catch (err: any) {
    console.error('Stats fetch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
