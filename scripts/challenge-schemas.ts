import { z } from 'zod';

export const cssChallengeFieldsSchema = z.object({
  title: z.string(),
  html: z.string(),
  targetCss: z.string(),
  starterCss: z.string(),
});

export type ChallengeFields = z.infer<typeof cssChallengeFieldsSchema>;

export const tailwindChallengeFieldsSchema = z.object({
  title: z.string(),
  targetHtml: z.string(),
  starterHtml: z.string(),
});

export type TailwindChallengeFields = z.infer<typeof tailwindChallengeFieldsSchema>;

function extractXmlTag(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) throw new Error(`Missing <${tag}> in response:\n${text.substring(0, 500)}`);
  return match[1].trim();
}

export function parseCssChallengeXml(text: string): ChallengeFields {
  return {
    title: extractXmlTag(text, 'title'),
    html: extractXmlTag(text, 'html'),
    targetCss: extractXmlTag(text, 'targetcss'),
    starterCss: extractXmlTag(text, 'startercss'),
  };
}

export function parseTailwindChallengeXml(text: string): TailwindChallengeFields {
  return normalizeTailwindFields({
    title: extractXmlTag(text, 'title'),
    targetHtml: extractXmlTag(text, 'targethtml'),
    starterHtml: extractXmlTag(text, 'starterhtml'),
  });
}

export function normalizeTailwindFields(fields: TailwindChallengeFields): TailwindChallengeFields {
  return {
    ...fields,
    // The editor requires two spaces so editable regions remain visible.
    starterHtml: fields.starterHtml.replace(/class="\s*"/g, 'class="  "'),
  };
}
