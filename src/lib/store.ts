import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';

export const supabase = createClient();

/**
 * Helper to fetch template details and reconstruct message content dynamically.
 * Incorporates Header, Body, and Footer components with sequential variable substitution.
 */
async function resolveTemplatesForMessages(rawMessages: any[]): Promise<any[]> {
  if (!rawMessages || rawMessages.length === 0) return [];

  // Find all messages that need template resolution
  const templateMessages = rawMessages.filter(
    (m: any) => (m.message_type === 'template' || m.template_name) && m.template_name
  );

  if (templateMessages.length === 0) return rawMessages;

  // Extract user_id from messages if available to limit query scope
  const userId = rawMessages.find((m: any) => m.user_id)?.user_id;

  try {
    // Query template details from supabase
    let query = supabase.from('whatsapp_portal_templates').select('*');
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
    let { data: templates, error } = await query;

    if (error) {
      console.error('Error fetching template details:', error);
      return rawMessages;
    }

    // Map normalized template_name -> template object
    const templateMap: Record<string, { body: string; header?: string; footer?: string; buttons?: any[] }> = {};
    if (templates) {
      templates.forEach((t: any) => {
        const normalizedKey = t.template_name.toLowerCase().replace(/_/g, '').trim();
        
        let extractedButtons = t.buttons || [];
        if ((!extractedButtons || extractedButtons.length === 0) && t.components && Array.isArray(t.components)) {
          const btnComponent = t.components.find((c: any) => c.type === 'BUTTONS');
          if (btnComponent && btnComponent.buttons) {
            extractedButtons = btnComponent.buttons;
          }
        }

        templateMap[normalizedKey] = {
          body: t.body || '',
          header: t.header || '',
          footer: t.footer || '',
          buttons: extractedButtons,
        };
      });
    }

    // Reconstruct content for template messages
    return rawMessages.map((msg: any) => {
      if ((msg.message_type === 'template' || msg.template_name) && msg.template_name) {
        const normalizedKey = msg.template_name.toLowerCase().replace(/_/g, '').trim();
        const template = templateMap[normalizedKey];
        const parameters = msg.metadata?.parameters || [];
        const buttons = msg.metadata?.buttons || [];
        
        if (buttons.length > 0) {
          msg.buttons = buttons;
        }

        if (template) {
          let paramIndex = 0;

          // Helper to substitute sequential placeholders from parameters array
          const replacePlaceholders = (text: string | undefined) => {
            if (!text) return '';
            return text.replace(/\{\{(\d+)\}\}/g, () => {
              const val = parameters[paramIndex++];
              return val !== undefined && val !== null ? String(val) : '';
            });
          };

          const resolvedHeader = replacePlaceholders(template.header);
          const resolvedBody = replacePlaceholders(template.body);
          const resolvedFooter = replacePlaceholders(template.footer);

          // Format template text with WhatsApp markdown constraints
          let fullContent = '';
          if (resolvedHeader) {
            fullContent += `*${resolvedHeader.trim()}*\n\n`;
          }
          fullContent += resolvedBody;
          if (resolvedFooter) {
            fullContent += `\n\n_${resolvedFooter.trim()}_`;
          }

          msg.content = fullContent;
          
          // Attach buttons if they exist and aren't already on the message
          if (template.buttons && template.buttons.length > 0 && (!msg.buttons || msg.buttons.length === 0)) {
            msg.buttons = template.buttons;
          }
        } else if (!msg.content) {
          msg.content = `[Template: ${msg.template_name}]`;
        }
      }
      return msg;
    });
  } catch (err) {
    console.error('Failed to resolve templates:', err);
    return rawMessages;
  }
}

export interface Contact {
  name: string;
  phone_number: string;
}

export interface Conversation {
  id: string;
  contact: Contact;
  last_message_at: string;
  last_message: string;
  unread_count: number;
}

export interface DashMessage {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string;
  created_at: string;
  status: string;
  media?: any[];
  media_url?: string;
  file_name?: string;
  file_size?: number;
  wa_message_id?: string;
  reactions?: any[];
  myReaction?: string;
  delivered_at?: string;
  seen_at?: string;
  context_message_id?: string;
  buttons?: any[];
  metadata?: {
    reply_to_message?: {
      sender_name: string;
      content: string;
    };
    [key: string]: any;
  };
}

export interface Template {
  id?: string;
  template_name: string;
  body?: string;
  header?: string;
  footer?: string;
  language?: string;
  category?: string;
  status?: string;
  normalized_name: string;
}

export interface DashStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;
  loadingConversations: boolean;
  loadingMessages: boolean;
  loadingOlderMessages: boolean;
  hasMoreMessages: boolean;
  error: string | null;

  messages: DashMessage[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  replyingToMessage: DashMessage | null;
  setReplyingToMessage: (msg: DashMessage | null) => void;
  fetchSingleMessage: (messageId: string) => Promise<DashMessage | null>;
  insertFetchedMessage: (msg: DashMessage) => void;

  templates: Template[];
  fetchTemplates: () => Promise<void>;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string, isInitial?: boolean) => Promise<void>;
  fetchOlderMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    to: string,
    content: string,
    conversationId: string,
    replyToMessageId?: string,
    replyToMessagePreview?: { sender_name: string; content: string }
  ) => Promise<void>;
  sendReaction: (to: string, messageId: string, emoji: string, internalMessageId: string) => Promise<void>;
  deleteMessage: (messageId: string, deleteType: 'me' | 'everyone') => Promise<void>;
  deleteMessages: (messageIds: string[], deleteType: 'me' | 'everyone') => Promise<void>;
}

export const useDashStore = create<DashStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  replyingToMessage: null,
  setReplyingToMessage: (msg) => set({ replyingToMessage: msg }),
  setActiveConversation: (id) => {
    set({ activeConversationId: id, messages: [], hasMoreMessages: true, replyingToMessage: null });
    if (id) {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === id ? { ...c, unread_count: 0 } : c
        )
      }));
      supabase
        .from('whatsapp_portal_conversations')
        .update({ unread_count: 0 })
        .eq('id', id)
        .then(({ error }: any) => {
          if (error) console.error('Failed to reset unread_count:', error);
        });
    }
  },
  loadingConversations: false,
  loadingMessages: false,
  loadingOlderMessages: false,
  hasMoreMessages: true,
  error: null,

  messages: [],
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  templates: [],
  fetchTemplates: async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_portal_templates')
        .select('*');

      if (error) throw error;

      const mapped = (data || []).map((t: any) => ({
        id: t.id,
        template_name: t.template_name,
        body: t.body,
        header: t.header,
        footer: t.footer,
        language: t.language,
        category: t.category,
        status: t.status,
        normalized_name: t.template_name.toLowerCase().replace(/_/g, '').trim()
      }));

      set({ templates: mapped });
    } catch (err: any) {
      console.error('Failed to fetch templates:', err?.message || err);
    }
  },

  fetchConversations: async () => {
    set({ loadingConversations: true, error: null });
    try {
      const { data, error } = await supabase
        .from('whatsapp_portal_conversations')
        .select(`
          id,
          last_message,
          last_message_at,
          unread_count,
          whatsapp_portal_contacts (
            name,
            phone_number,
            profile_name
          )
        `)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      
      const activeId = get().activeConversationId;
      const convs = (data || []).map((row: any) => {
        const isCurrentActive = row.id === activeId;
        
        if (isCurrentActive && row.unread_count > 0) {
          supabase
            .from('whatsapp_portal_conversations')
            .update({ unread_count: 0 })
            .eq('id', row.id)
            .then(({ error }: any) => {
              if (error) console.error('Failed to update unread_count on active conversation poll:', error);
            });
        }

        return {
          id: row.id,
          contact: {
            name: row.whatsapp_portal_contacts?.name || row.whatsapp_portal_contacts?.profile_name || row.whatsapp_portal_contacts?.phone_number || 'Unknown',
            phone_number: row.whatsapp_portal_contacts?.phone_number || ''
          },
          last_message: row.last_message || '',
          last_message_at: row.last_message_at,
          unread_count: isCurrentActive ? 0 : (row.unread_count || 0)
        };
      });

      set({ conversations: convs });
    } catch (err: any) {
      console.error('Failed to fetch conversations:', err?.message || err);
      set({ error: err.message });
    } finally {
      set({ loadingConversations: false });
    }
  },

  fetchMessages: async (conversationId: string, isInitial = true) => {
    if (isInitial) {
      set({ loadingMessages: true, hasMoreMessages: true });
    }
    try {
      if (isInitial) {
        // 1. Initial Load: Fetch newest 30 messages in descending order, then reverse them
        const { data, error } = await supabase
          .from('whatsapp_portal_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(30);

        if (error) throw error;

      // Resolve template content dynamically
      const resolvedData = await resolveTemplatesForMessages(data || []);
      const visibleData = resolvedData.filter((log: any) => !log.metadata?.hidden_for_user);
      
      const mapped: DashMessage[] = visibleData.map((log: any) => ({
          id: log.id,
          conversation_id: log.conversation_id,
          direction: log.direction,
          message_type: log.message_type || 'text',
          content: log.content || '',
          created_at: log.created_at,
          status: log.status || 'sent',
          wa_message_id: log.wa_message_id,
          reactions: log.reactions,
          delivered_at: log.delivered_at,
          seen_at: log.seen_at,
          media: log.media,
          media_url: log.media_url || log.metadata?.media_url || '',
          file_name: log.file_name,
          file_size: log.file_size,
          context_message_id: log.context_message_id,
          buttons: log.buttons || log.metadata?.buttons,
          metadata: {
            ...log.metadata,
            media_url: log.metadata?.media_url || log.media_url || ''
          }
        }));

        const reversed = mapped.reverse();
        set({ 
          messages: reversed,
          hasMoreMessages: mapped.length === 30
        });
      } else {
        // 2. Polling Updates (isInitial = false): Fetch 30 newest.
        const { data, error } = await supabase
          .from('whatsapp_portal_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(30);

        if (error) throw error;

        const currentMessages = get().messages;
        const visibleData = (data || []).filter((log: any) => !log.metadata?.hidden_for_user);
        const mapped = visibleData.map((log: any) => ({
          id: log.id,
          conversation_id: log.conversation_id,
          direction: log.direction,
          message_type: log.message_type || 'text',
          content: log.content || '',
          created_at: log.created_at,
          status: log.status || 'sent',
          wa_message_id: log.wa_message_id,
          reactions: log.reactions,
          delivered_at: log.delivered_at,
          seen_at: log.seen_at,
          media: log.media,
          media_url: log.media_url || log.metadata?.media_url || '',
          file_name: log.file_name,
          file_size: log.file_size,
          context_message_id: log.context_message_id,
          buttons: log.buttons || log.metadata?.buttons,
          metadata: {
            ...log.metadata,
            media_url: log.metadata?.media_url || log.media_url || ''
          }
        }));

        const newestInDb = mapped.reverse(); // Now ascending
        if (newestInDb.length === 0) return;

        // Map existing messages by id or wa_message_id for easy lookup
        const existingMap = new Map<string, DashMessage>();
        currentMessages.forEach(m => {
          existingMap.set(m.id, m);
          if (m.wa_message_id) {
            existingMap.set(m.wa_message_id, m);
          }
        });

        // Determine what the newest timestamp in state is
        let newestTimestampInState = new Date(0);
        if (currentMessages.length > 0) {
          newestTimestampInState = new Date(currentMessages[currentMessages.length - 1].created_at);
        }

        const updatedMessages = [...currentMessages];
        const toAppend: DashMessage[] = [];

        newestInDb.forEach((msg: DashMessage) => {
          const existing = existingMap.get(msg.id) || (msg.wa_message_id ? existingMap.get(msg.wa_message_id) : undefined);
          if (existing) {
            // Update modified status (read, delivered, reactions, etc.) in place
            Object.assign(existing, {
              status: msg.status,
              reactions: msg.reactions,
              delivered_at: msg.delivered_at,
              seen_at: msg.seen_at,
              media_url: msg.media_url || existing.media_url || "",
              context_message_id: msg.context_message_id || existing.context_message_id,
              metadata: {
                ...existing.metadata,
                ...msg.metadata,
                media_url: msg.metadata?.media_url || msg.media_url || existing.metadata?.media_url || existing.media_url || ""
              }
            });
          } else {
            // Append only if it is newer than the newest in state (avoids duplicate/overlapping prepended messages)
            const msgTime = new Date(msg.created_at);
            if (msgTime > newestTimestampInState) {
              toAppend.push(msg);
            }
          }
        });

        set({ messages: [...updatedMessages, ...toAppend] });
      }
    } catch (err: any) {
      console.error('Failed to fetch messages:', err?.message || err);
    } finally {
      if (isInitial) {
        set({ loadingMessages: false });
      }
    }
  },

  fetchOlderMessages: async (conversationId: string) => {
    const currentMessages = get().messages;
    if (currentMessages.length === 0) return;
    
    // Earliest message timestamp in state is the first message's created_at
    const earliestMessageTimestamp = currentMessages[0].created_at;
    set({ loadingOlderMessages: true });

    try {
      const { data, error } = await supabase
        .from('whatsapp_portal_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .lt('created_at', earliestMessageTimestamp)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      if (!data || data.length === 0) {
        set({ hasMoreMessages: false });
        return;
      }

      // Resolve template content dynamically
      const resolvedData = await resolveTemplatesForMessages(data);
      const visibleData = resolvedData.filter((log: any) => !log.metadata?.hidden_for_user);

      const olderMapped: DashMessage[] = visibleData.map((log: any) => ({
        id: log.id,
        conversation_id: log.conversation_id,
        direction: log.direction,
        message_type: log.message_type || 'text',
        content: log.content || '',
        created_at: log.created_at,
        status: log.status || 'sent',
        wa_message_id: log.wa_message_id,
        reactions: log.reactions,
        delivered_at: log.delivered_at,
        seen_at: log.seen_at,
        media: log.media,
        media_url: log.media_url || log.metadata?.media_url || '',
        file_name: log.file_name,
        file_size: log.file_size,
        context_message_id: log.context_message_id,
        buttons: log.buttons || log.metadata?.buttons,
        metadata: {
          ...log.metadata,
          media_url: log.metadata?.media_url || log.media_url || ''
        }
      }));

      const reversed = olderMapped.reverse();
      set({
        messages: [...reversed, ...currentMessages],
        hasMoreMessages: olderMapped.length === 30
      });
    } catch (err: any) {
      console.error('Failed to fetch older messages:', err?.message || err);
    } finally {
      set({ loadingOlderMessages: false });
    }
  },

  fetchSingleMessage: async (messageId: string) => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_portal_messages')
        .select('*')
        .or(`id.eq.${messageId},wa_message_id.eq.${messageId}`)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        conversation_id: data.conversation_id,
        direction: data.direction,
        message_type: data.message_type || 'text',
        content: data.content || '',
        created_at: data.created_at,
        status: data.status || 'sent',
        wa_message_id: data.wa_message_id,
        reactions: data.reactions,
        delivered_at: data.delivered_at,
        seen_at: data.seen_at,
        media: data.media,
        media_url: data.media_url || data.metadata?.media_url || '',
        file_name: data.file_name,
        file_size: data.file_size,
        context_message_id: data.context_message_id,
        buttons: data.buttons || data.metadata?.buttons,
        metadata: {
          ...data.metadata,
          media_url: data.metadata?.media_url || data.media_url || ''
        },
      };
    } catch (err) {
      console.error('Failed to fetch single message:', err);
      return null;
    }
  },

  insertFetchedMessage: (msg: DashMessage) => {
    const currentMessages = get().messages;
    if (currentMessages.some(m => m.id === msg.id || (msg.wa_message_id && m.wa_message_id === msg.wa_message_id))) {
      return;
    }
    const updated = [...currentMessages, msg];
    updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    set({ messages: updated });
  },

  sendMessage: async (to, content, conversationId, replyToMessageId, replyToMessagePreview) => {
    const tempId = 'temp-' + Date.now();
    const optimisticMessage: DashMessage = {
      id: tempId,
      conversation_id: conversationId,
      direction: 'outbound',
      message_type: 'text',
      content,
      created_at: new Date().toISOString(),
      status: 'sending',
      context_message_id: replyToMessageId,
      metadata: replyToMessagePreview ? { reply_to_message: replyToMessagePreview } : undefined,
    };

    // Optimistically add message
    set(state => ({
      messages: [...state.messages, optimisticMessage]
    }));

    try {
      const response = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          message: content,
          conversationId,
          replyToMessageId,
          replyToMessagePreview,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      // Update message with database details
      set(state => ({
        messages: state.messages.map(m =>
          m.id === tempId
            ? { ...m, id: data.messageId || m.id, wa_message_id: data.waMessageId, status: 'sent' }
            : m
        ),
        conversations: state.conversations.map(c =>
          c.id === conversationId
            ? { ...c, last_message: content, last_message_at: new Date().toISOString() }
            : c
        )
      }));
    } catch (err: any) {
      console.error('Send message error:', err);
      // Mark as failed
      set(state => ({
        messages: state.messages.map(m =>
          m.id === tempId
            ? { ...m, status: 'failed' }
            : m
        ),
        error: err.message
      }));
    }
  },

  sendReaction: async (to, messageId, emoji, internalMessageId) => {
    // Optimistic update
    set(state => ({
      messages: state.messages.map(m =>
        m.id === internalMessageId
          ? { ...m, myReaction: emoji || undefined }
          : m
      )
    }));

    try {
      const response = await fetch('/api/send-reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, messageId, emoji }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reaction');
      }
    } catch (err: any) {
      console.error('Send reaction error:', err);
      // Revert optimistic update
      set(state => ({
        messages: state.messages.map(m =>
          m.id === internalMessageId
            ? { ...m, myReaction: undefined }
            : m
        ),
        error: err.message
      }));
    }
  },

  deleteMessage: async (messageId: string, deleteType: 'me' | 'everyone') => {
    try {
      const { data: config } = await supabase
        .from('whatsapp_portal_configs')
        .select('phone_number_id, user_id')
        .limit(1)
        .maybeSingle();

      if (!config) {
        throw new Error('WhatsApp configuration not found.');
      }

      const { data: dbMsg } = await supabase
        .from('whatsapp_portal_messages')
        .select('wa_message_id')
        .eq('id', messageId)
        .maybeSingle();

      const wamid = dbMsg?.wa_message_id || messageId;

      const res = await fetch('/api/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: wamid,
          phone_number_id: config.phone_number_id,
          user_id: config.user_id,
          delete_type: deleteType
        })
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error(resData.error || 'Failed to delete message');
      }

      // Update local state
      if (deleteType === 'me') {
        set(state => ({
          messages: state.messages.filter(m => m.id !== messageId)
        }));
      } else {
        set(state => ({
          messages: state.messages.map(m => 
            m.id === messageId 
              ? { ...m, content: '🚫 This message was deleted', message_type: 'revoked', metadata: { ...m.metadata, revoked: true } }
              : m
          )
        }));
      }
    } catch (err: any) {
      console.error('Failed to delete message:', err);
      set({ error: err.message });
      throw err;
    }
  },

  deleteMessages: async (messageIds: string[], deleteType: 'me' | 'everyone') => {
    try {
      const { data: config } = await supabase
        .from('whatsapp_portal_configs')
        .select('phone_number_id, user_id')
        .limit(1)
        .maybeSingle();

      if (!config) {
        throw new Error('WhatsApp configuration not found.');
      }

      for (const msgId of messageIds) {
        const { data: dbMsg } = await supabase
          .from('whatsapp_portal_messages')
          .select('wa_message_id')
          .eq('id', msgId)
          .maybeSingle();

        const wamid = dbMsg?.wa_message_id || msgId;

        try {
          const res = await fetch('/api/messages/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message_id: wamid,
              phone_number_id: config.phone_number_id,
              user_id: config.user_id,
              delete_type: deleteType
            })
          });
          const resData = await res.json();
          if (!res.ok || !resData.success) {
            console.error(`Failed to delete message ${msgId}:`, resData.error);
          }
        } catch (e) {
          console.error(`Error deleting message ${msgId}:`, e);
        }
      }

      // Realign local state
      if (deleteType === 'me') {
        set(state => ({
          messages: state.messages.filter(m => !messageIds.includes(m.id))
        }));
      } else {
        set(state => ({
          messages: state.messages.map(m => 
            messageIds.includes(m.id)
              ? { ...m, content: '🚫 This message was deleted', message_type: 'revoked', metadata: { ...m.metadata, revoked: true } }
              : m
          )
        }));
      }
    } catch (err: any) {
      console.error('Failed to delete messages:', err);
      set({ error: err.message });
      throw err;
    }
  }
}));
