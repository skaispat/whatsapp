import axios from 'axios';
import {
  WHATSAPP_NORMALIZABLE_IMAGE_MIME_TYPES,
  WHATSAPP_SUPPORTED_DOCUMENT_MIME_TYPES,
  WHATSAPP_SUPPORTED_FORMATS_LABEL,
  WHATSAPP_SUPPORTED_VIDEO_MIME_TYPES,
  getSupportedMimeType,
  isCsvFile,
} from '@/lib/mediaSupport';

interface SendMessageParams {
  to: string;
  message: string;
  accessToken: string;
  phoneNumberId: string;
  contextMessageId?: string;
}

interface SendMessageResponse {
  messageId: string;
}

/**
 * Send a text message via WhatsApp Cloud API
 */
export async function sendWhatsAppMessage({
  to,
  message,
  accessToken,
  phoneNumberId,
  contextMessageId,
}: SendMessageParams): Promise<SendMessageResponse> {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
      ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const waMessageId = response.data?.messages?.[0]?.id;
  if (!waMessageId) {
    throw new Error('No message ID returned from WhatsApp API');
  }

  return { messageId: waMessageId };
}

/**
 * Send an emoji reaction to a message via WhatsApp Cloud API.
 * Pass an empty string for `emoji` to remove a reaction.
 */
export async function sendWhatsAppReaction({
  to,
  messageId,
  emoji,
  accessToken,
  phoneNumberId,
}: {
  to: string;
  messageId: string;
  emoji: string;
  accessToken: string;
  phoneNumberId: string;
}): Promise<{ waMessageId: string }> {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: {
        message_id: messageId,
        emoji,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const waMessageId = response.data?.messages?.[0]?.id;
  if (!waMessageId) {
    throw new Error('No message ID returned from WhatsApp API');
  }
  return { waMessageId };
}

/**
 * Verify the Meta access token is valid by calling the API
 */
export async function verifyMetaToken(
  accessToken: string,
  phoneNumberId: string
): Promise<{ valid: boolean; phoneNumber?: string; error?: string }> {
  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      valid: true,
      phoneNumber: response.data?.display_phone_number || response.data?.verified_name,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: err?.response?.data?.error?.message || 'Invalid token or phone number ID',
    };
  }
}

interface SendTemplateParams {
  to: string;
  templateName: string;
  languageCode: string;
  components: any[];
  accessToken: string;
  phoneNumberId: string;
}

// Re-export shared types and pure helpers from the client-safe module so
// server-side code (API routes) can import them from whatsapp.ts as before.
export type {
  WhatsAppTemplateButton,
  WhatsAppTemplateMeta,
} from '@/lib/templateUtils';
export {
  convertGoogleDriveLinkToDirect,
  buildTemplateComponents,
} from '@/lib/templateUtils';

import type { WhatsAppTemplateButton, WhatsAppTemplateMeta } from '@/lib/templateUtils';

/**
 * Fetch all approved message templates from the WhatsApp Business Management API.
 * Returns rich metadata including header type and button definitions.
 */
export async function fetchWhatsAppTemplates({
  wabaId,
  accessToken,
}: {
  wabaId: string;
  accessToken: string;
}): Promise<WhatsAppTemplateMeta[]> {
  try {
    const url = `https://graph.facebook.com/v19.0/${wabaId}/message_templates?status=APPROVED&fields=name,category,components,language&limit=100`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const templates: WhatsAppTemplateMeta[] = [];
    for (const t of response.data?.data || []) {
      const comps: any[] = t.components || [];
      const headerComp  = comps.find((c: any) => c.type === 'HEADER');
      const bodyComp    = comps.find((c: any) => c.type === 'BODY');
      const footerComp  = comps.find((c: any) => c.type === 'FOOTER');
      const buttonComps = comps.filter((c: any) => c.type === 'BUTTONS');

      const headerType     = (headerComp?.format || '').toUpperCase() as string;
      const hasImageHeader = headerType === 'IMAGE';

      // Flatten buttons from BUTTONS component
      const buttons: WhatsAppTemplateButton[] = [];
      for (const bc of buttonComps) {
        for (const btn of bc.buttons || []) {
          buttons.push({
            type: btn.type as WhatsAppTemplateButton['type'],
            text: btn.text || '',
            url: btn.url,
            phone_number: btn.phone_number,
            example: btn.example,
          });
        }
      }

      templates.push({
        name: t.name,
        category: (t.category || '').toLowerCase(),
        header: headerComp?.text || '',
        headerType,
        hasImageHeader,
        body: bodyComp?.text || '',
        footer: footerComp?.text || '',
        language: t.language || '',
        buttons,
      });
    }
    return templates;
  } catch (err: any) {
    console.error('Failed to fetch WhatsApp templates:', err?.response?.data || err.message);
    return [];
  }
}


/**
 * Resolve the body text and name of a template by matching its category or name.
 * Priority: 1. Exact name match, 2. Category match, 3. Single template fallback.
 */
export function resolveTemplateInfo(
  templates: { name: string; category: string; body: string }[],
  pricingCategory?: string,
  exactName?: string
): { name: string; body: string } {
  if (templates.length === 0) return { name: 'unknown', body: '[Template Message]' };

  // 1. Priority: Exact Name Match (from biz_opaque_callback_data)
  if (exactName) {
    const match = templates.find(t => t.name.toLowerCase() === exactName.toLowerCase());
    if (match) return { name: match.name, body: match.body };
  }

  // 2. Secondary: Pricing Category Match
  if (pricingCategory) {
    const catLower = pricingCategory.toLowerCase();
    const matched = templates.filter((t) => t.category === catLower);
    if (matched.length > 0) {
      // Use the first match in the category
      return { name: matched[0].name, body: matched[0].body };
    }
  }

  // 3. Fallback: If only one template total
  if (templates.length === 1) {
    return { name: templates[0].name, body: templates[0].body };
  }

  return { name: exactName || 'unknown', body: '[Template Message]' };
}

/**
 * Given a template body with placeholders like {{1}}, {{2}}, and the components
 * array from a WhatsApp API send request, substitute the placeholders with real values.
 *
 * Components format from WhatsApp API:
 * [{ type: "body", parameters: [{ type: "text", text: "John" }, { type: "text", text: "123" }] }]
 */
export function resolveTemplateTextWithParams(
  templateBody: string,
  components: any[]
): string {
  if (!templateBody || !components || components.length === 0) return templateBody;

  // Find the body component
  const bodyComponent = components.find(
    (c: any) => c.type === 'body' || c.type === 'BODY'
  );

  if (!bodyComponent?.parameters || bodyComponent.parameters.length === 0) {
    return templateBody;
  }

  let resolved = templateBody;
  bodyComponent.parameters.forEach((param: any, index: number) => {
    const placeholder = `{{${index + 1}}}`;
    const value = param.text || param.value || '';
    resolved = resolved.replace(placeholder, value);
  });

  return resolved;
}

/**
 * Fetch a specific template by name from Meta and return its body text
 * with parameters substituted if components are provided.
 */
export async function resolveTemplateFinalText({
  wabaId,
  accessToken,
  templateName,
  languageCode,
  components,
}: {
  wabaId: string;
  accessToken: string;
  templateName: string;
  languageCode: string;
  components: any[];
}): Promise<string> {
  const templates = await fetchWhatsAppTemplates({ wabaId, accessToken });
  
  // Find the exact template by name
  const match = templates.find((t) => t.name === templateName);

  if (!match || !match.body) {
    return `[Template: ${templateName}]`;
  }

  // Resolve all parts (Header + Body + Footer)
  const headerComp = components.find(c => c.type === 'header' || c.type === 'HEADER');

  let finalHeader = '';
  if (match.hasImageHeader) {
    // Image header — show the image URL or a placeholder in stored content
    const imgParam = headerComp?.parameters?.find((p: any) => p.type === 'image');
    finalHeader = imgParam?.image?.link ? `[Image: ${imgParam.image.link}]` : '[Image]';
  } else if (match.header) {
    finalHeader = match.header;
    if (headerComp?.parameters) {
      headerComp.parameters.forEach((param: any, idx: number) => {
        finalHeader = finalHeader.replace(`{{${idx + 1}}}`, param.text || param.value || '');
      });
    }
  }

  let finalBody = resolveTemplateTextWithParams(match.body, components);

  let fullContent = "";
  if (finalHeader) fullContent += `*${finalHeader}*\n\n`;
  fullContent += finalBody;
  if (match.footer) fullContent += `\n\n_${match.footer}_`;

  return fullContent;
}

export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode,
  components,
  accessToken,
  phoneNumberId,
}: SendTemplateParams): Promise<SendMessageResponse> {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components: components,
      },
      biz_opaque_callback_data: templateName, // Embed template name for webhook tracking
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const waMessageId = response.data?.messages?.[0]?.id;
  if (!waMessageId) {
    throw new Error('No message ID returned from WhatsApp API');
  }

  return { messageId: waMessageId };
}

interface SendMediaMessageParams {
  to: string;
  mediaId: string;
  mediaType: 'image' | 'video' | 'document';
  caption?: string;
  fileName?: string;
  accessToken: string;
  phoneNumberId: string;
}

/**
 * Upload a media file to Meta's WhatsApp servers
 * Uses native fetch (not axios) — axios cannot serialize browser File/Blob objects
 * as binary in Node.js server context, causing ETIMEDOUT errors.
 * Also normalizes images with sharp to ensure Meta compatibility (error 131053).
 */
export async function uploadWhatsAppMedia({
  file,
  accessToken,
  phoneNumberId,
}: {
  file: File | Blob;
  accessToken: string;
  phoneNumberId: string;
}): Promise<string> {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/media`;

  const rawMime = getSupportedMimeType(file as File) || 'application/octet-stream';
  const fileName = (file as File).name || 'media';

  // Validate Meta-supported types
  const isImage    = WHATSAPP_NORMALIZABLE_IMAGE_MIME_TYPES.includes(rawMime);
  const isVideo    = WHATSAPP_SUPPORTED_VIDEO_MIME_TYPES.includes(rawMime);
  const isDocument = WHATSAPP_SUPPORTED_DOCUMENT_MIME_TYPES.includes(rawMime);
  const isCsv      = isCsvFile(file as File);

  if (!isImage && !isVideo && !isDocument && !isCsv) {
    throw new Error(
      `Unsupported file type "${rawMime}". Meta WhatsApp supports: ${WHATSAPP_SUPPORTED_FORMATS_LABEL}.`
    );
  }

  // Read raw bytes
  const arrayBuffer = await file.arrayBuffer();
  let uploadBuffer: Buffer = Buffer.from(arrayBuffer);
  let uploadMime: string   = rawMime;
  let uploadName: string   = fileName;

  if (isCsv) {
    // WhatsApp Cloud does not accept text/csv, so send CSVs as equivalent XLSX documents.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx') as typeof import('xlsx');
    const workbook = XLSX.read(uploadBuffer.toString('utf8'), { type: 'string' });
    const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    uploadBuffer = Buffer.from(xlsxBuffer);
    uploadMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    uploadName = fileName.replace(/\.csv$/i, '.xlsx');
    console.log(`CSV converted to XLSX for Meta upload: ${uploadName}`);
  }

  // ── Normalize images with sharp ─────────────────────────────────────────
  // Meta requires: JPG/PNG, RGB or RGBA, 8-bit per channel.
  // This handles CMYK, 16-bit, WebP, HEIC, AVIF, etc. automatically.
  if (isImage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sharp = require('sharp') as typeof import('sharp');
      uploadBuffer = await sharp(uploadBuffer)
        .toColorspace('srgb')          // force RGB (fixes CMYK issues)
        .jpeg({ quality: 90, mozjpeg: true })  // output safe 8-bit JPEG
        .toBuffer();
      uploadMime = 'image/jpeg';
      uploadName = fileName.replace(/\.[^.]+$/, '.jpg');
      console.log(`📸 Image normalized to JPEG for Meta upload: ${uploadName}`);
    } catch (sharpErr) {
      console.warn('⚠️ sharp normalization failed, uploading original:', sharpErr);
      // fall through with original buffer
    }
  }

  // ── Build FormData and upload ───────────────────────────────────────────
  // Use Uint8Array — Buffer<ArrayBufferLike> is not directly assignable to BlobPart in TS strict mode
  const blob     = new Blob([new Uint8Array(uploadBuffer)], { type: uploadMime });
  const formData = new FormData();
  formData.append('file', blob, uploadName);
  formData.append('type', uploadMime);
  formData.append('messaging_product', 'whatsapp');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const errMsg = (errBody as any)?.error?.message || `Meta API error ${response.status}`;
    throw new Error(errMsg);
  }

  const data     = await response.json() as { id?: string };
  const mediaId  = data?.id;
  if (!mediaId) {
    throw new Error('No media ID returned from Meta upload API');
  }
  return mediaId;
}


/**
 * Send a media message (image, video, document) via WhatsApp Cloud API
 */
export async function sendWhatsAppMediaMessage({
  to,
  mediaId,
  mediaType,
  caption,
  fileName,
  accessToken,
  phoneNumberId,
}: SendMediaMessageParams): Promise<SendMessageResponse> {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const mediaObject: any = { id: mediaId };
  if (caption) {
    mediaObject.caption = caption;
  }
  if (mediaType === 'document' && fileName) {
    mediaObject.filename = fileName;
  }

  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: mediaType,
      [mediaType]: mediaObject,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const waMessageId = response.data?.messages?.[0]?.id;
  if (!waMessageId) {
    throw new Error('No message ID returned from WhatsApp API');
  }

  return { messageId: waMessageId };
}
