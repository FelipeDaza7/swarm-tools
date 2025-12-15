import { docs } from 'fumadocs-mdx:collections/server';
import { loader, type InferPageType } from 'fumadocs-core/source';
import type { DocData, DocMethods } from 'fumadocs-mdx/runtime/types';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

// Workaround for fumadocs-mdx 14.x bug: generated .source/server.ts has @ts-nocheck
// which breaks type inference. Manually extend PageData with MDX properties.
// Track: https://github.com/fuma-nama/fumadocs/issues (file if not exists)
type BasePageType = InferPageType<typeof source>;
export type Page = Omit<BasePageType, 'data'> & {
  data: BasePageType['data'] & DocData & DocMethods & { full?: boolean };
};
