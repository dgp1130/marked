import 'jasmine';

import { marked, Renderer } from 'marked';
import * as prism from 'prismjs';
import PrismLoader from 'prismjs/components/index';

describe('marked', () => {
    it('processes markdown', () => {
        const html = marked(`
# Hello, World!

This is some text.

* foo
* bar
* baz
        `.trim());

        expect(html).toContain('<h1 id="hello-world">Hello, World!</h1>');
        expect(html).toContain('<p>This is some text.</p>');
        expect(html).toContain('<li>foo</li>');
        expect(html).toContain('<li>bar</li>');
        expect(html).toContain('<li>baz</li>');
    });

    it('anchors headers', () => {
        expect(marked('# Hello, World!', { headerIds: true }).trim())
            .toBe('<h1 id="hello-world">Hello, World!</h1>');
    });

    it('custom parser', () => {
        const renderer = new class extends Renderer {
            public override code(code: string, language: string | undefined, isEscaped: boolean): string {
                if (language !== 'custom') return super.code(code, language, isEscaped);

                return `
<div class="custom">
${code}
</div>
                `.trim();
            }
        }();

        const customHtml = marked(`
\`\`\`custom
Hello, World!
\`\`\`
        `.trim(), { renderer });

        expect(customHtml).toBe(`
<div class="custom">
Hello, World!
</div>
        `.trim());

        const tsHtml = marked(`
\`\`\`typescript
Hello, TypeScript!
\`\`\`
        `.trim(), { renderer });

        expect(tsHtml).toContain(`
<code class="language-typescript">Hello, TypeScript!
</code>
        `.trim());
    });

    it('json renderer', () => {
        const renderer = new class extends Renderer {
            public override code(code: string, language: string | undefined, isEscaped: boolean): string {
                if (language !== 'json') return super.code(code, language, isEscaped);

                const json = JSON.parse(code);
                const mapping = Object.entries(json)
                    .map(([ key, value ]) => `    ${key} => ${value}`)
                    .join('\n')
                ;
                return `
<div class="mapping">
{
${mapping}
}
</div>
                `.trim();
            }
        }();

        const html = marked(`
\`\`\`json
{
    "foo": "bar",
    "hello": "world"
}
\`\`\`
        `.trim(), { renderer });

        expect(html).toBe(`
<div class="mapping">
{
    foo => bar
    hello => world
}
</div>
        `.trim());
    });

    it('image elements', () => {
        expect(marked(`![a11y](/foo.png)`)).toContain(`<img src="/foo.png" alt="a11y">`);
    });

    it('picture elements', () => {
        interface PictureToken extends marked.Tokens.Generic {
            type: 'picture';
            alt: string;
            sources: string[];
        }

        function* matches(regex: RegExp, content: string): Generator<RegExpExecArray> {
            let match: RegExpExecArray | null = null;
            while ((match = regex.exec(content)) !== null) {
                yield match;
            }
        }

        // TODO: Stop using global state here.
        marked.use({ extensions: [
            {
                name: 'picture',
                level: 'inline',

                start(src: string): number {
                    return src.match(/^!\[/)?.index ?? -1;
                },

                tokenizer(raw: string, tokens: marked.Token[]): PictureToken | undefined {
                    // Separate the alt text and source list from markdown.
                    const match = raw.match(/!\[(?<alt>[^\]]*)\](?<sources>.*)/);
                    if (!match) return undefined;
                    const alt = match.groups?.['alt'] ?? '';
                    const rawSources = match.groups?.['sources'];
                    if (!rawSources) throw new Error(`No sources: ${raw}`);

                    // Parse the sources.
                    const sources = Array.from(matches(/\((?<source>[^)]*)\)/g, rawSources))
                        .map((match) => match.groups?.['source']!)
                    ;

                    // Just one source, should be an `<img />` tag.
                    if (sources.length === 1) {
                        return undefined;
                    }

                    return {
                        type: 'picture',
                        raw,
                        alt,
                        sources,
                    };
                },

                renderer(inputToken: marked.Tokens.Generic): string {
                    // Validate input token.
                    if (inputToken.type !== 'picture') throw new Error(`Unknown token of type: ${inputToken.type}`);
                    const token = inputToken as PictureToken;
                    if (token.sources.length === 0) throw new Error(`Picture token has zero sources: ${token.raw}`);

                    // Extract the final, default source.
                    const [ defaultSource ] = token.sources.slice(-1);
                    const sources = token.sources.slice(0, -1);

                    // Render the picture.
                    return `
<picture>
${sources.map((source) => `    <source srcset="${source}" />`).join('\n')}
    <img srcset="${defaultSource}" alt="${token.alt}" />
</picture>
                    `.trim();
                },
            },
        ] });

        expect(marked(`![a11y](/foo.avif)(/foo.webp)(/foo.png)`)).toContain(`
<picture>
    <source srcset="/foo.avif" />
    <source srcset="/foo.webp" />
    <img srcset="/foo.png" alt="a11y" />
</picture>
        `.trim());

        // TODO: title
        // TODO: mime types
    });

    it('target blank', () => {
        const renderer = new class extends Renderer {
            public override link(href: string | null, title: string | null, text: string): string {
                const hrefAttr = href ? `href="${href}"` : ``;
                const titleAttr = title ? `title="${title}"` : ``; // TODO: Escape.
                const targetAttr = href?.startsWith('#') ? `` : `target="_blank"`;
                return `<a ${hrefAttr} ${titleAttr} ${targetAttr}>${text}</a>`;
            }
        }();

        expect(marked(`[foo](http://bar.test/)`, { renderer })).toContain('target="_blank"');
        expect(marked(`[foo](#bar)`, { renderer })).not.toContain('target="_blank"');
    });

    it('timestamp', () => {
        const renderer = new class extends Renderer {
            public override code(code: string, language: string | undefined, isEscaped: boolean): string {
                if (language !== 'timestamp') return super.code(code, language, isEscaped);

                const date = new Date(code.trim());
                return `<time datetime="${date.toISOString()}">${date.toLocaleDateString()}</time>`;
            }
        }();

        const html = marked(`
\`\`\` timestamp
2022-02-16T09:00:00-0700
\`\`\`
        `.trim(), { renderer });

        expect(html).toBe(`
<time datetime="2022-02-16T16:00:00.000Z">2/16/2022</time>
        `.trim());
    });

    it('highlighting', () => {
        // Prism doesn't load all languages immediately. Need to call `PrismLoader` with the
        // desired language, which will have the side effect of add the grammar to
        // `prism.languages` if it is supported.
        function loadGrammar(lang: string): prism.Grammar {
            const alreadyLoadedGrammar = prism.languages[lang];
            if (alreadyLoadedGrammar) return alreadyLoadedGrammar;

            // Load grammar for language and add it to `prism.languages` if supported.
            PrismLoader(lang);

            const newlyLoadedGrammar = prism.languages[lang];
            if (newlyLoadedGrammar) return newlyLoadedGrammar;

            throw new Error(`Unknown language \`${lang}\` in Prism.`);
        }

        function highlight(code: string, lang: string): string {
            return prism.highlight(code, loadGrammar(lang), lang);
        }

        expect(marked(`
\`\`\`typescript
export const foo: string = 'Hello, World!';
\`\`\`
        `.trim(), { highlight })).toContain(`<span class="token keyword">export</span>`);
    });

    it('html', () => {
        expect(marked(`<foo-bar>Hello, World!</foo-bar>`))
            .toContain(`<foo-bar>Hello, World!</foo-bar>`);
    });
});