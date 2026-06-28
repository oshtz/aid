import React, { useMemo } from 'react';
import { marked, type Token, type Tokens } from 'marked';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

const markdownOptions = {
  breaks: true,
  gfm: true,
};

const htmlEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const decodeHtmlEntities = (value: string): string => {
  return value.replace(/&(#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, (match, entity: string) => {
    const normalizedEntity = entity.toLowerCase();

    if (normalizedEntity.startsWith('#x')) {
      const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }

    if (normalizedEntity.startsWith('#')) {
      const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }

    return htmlEntities[normalizedEntity] || match;
  });
};

const isSafeLink = (href: string): boolean => /^(https?:\/\/|mailto:)/i.test(href);

const renderInlineTokens = (tokens: Token[] = [], keyPrefix: string): React.ReactNode[] => {
  return tokens.map((token, index) => renderInlineToken(token, `${keyPrefix}-${index}`));
};

const renderInlineToken = (token: Token, key: string): React.ReactNode => {
  switch (token.type) {
    case 'text': {
      const textToken = token as Tokens.Text;
      return textToken.tokens
        ? renderInlineTokens(textToken.tokens, key)
        : decodeHtmlEntities(textToken.text);
    }
    case 'escape':
      return decodeHtmlEntities((token as Tokens.Escape).text);
    case 'strong':
      return (
        <strong key={key}>
          {renderInlineTokens((token as Tokens.Strong).tokens, key)}
        </strong>
      );
    case 'em':
      return (
        <em key={key}>
          {renderInlineTokens((token as Tokens.Em).tokens, key)}
        </em>
      );
    case 'del':
      return (
        <del key={key}>
          {renderInlineTokens((token as Tokens.Del).tokens, key)}
        </del>
      );
    case 'codespan':
      return (
        <code key={key} className="markdown-inline-code">
          {decodeHtmlEntities((token as Tokens.Codespan).text)}
        </code>
      );
    case 'br':
      return <br key={key} />;
    case 'link': {
      const linkToken = token as Tokens.Link;
      if (!isSafeLink(linkToken.href)) {
        return renderInlineTokens(linkToken.tokens, key);
      }

      return (
        <a
          key={key}
          href={linkToken.href}
          title={linkToken.title || undefined}
          className="markdown-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          {renderInlineTokens(linkToken.tokens, key)}
        </a>
      );
    }
    case 'image':
      return decodeHtmlEntities((token as Tokens.Image).text);
    case 'html':
      return decodeHtmlEntities((token as Tokens.HTML).text);
    default:
      return decodeHtmlEntities('text' in token ? String(token.text) : token.raw);
  }
};

const renderBlockToken = (token: Token, key: string): React.ReactNode => {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'heading': {
      const heading = token as Tokens.Heading;
      const Tag = `h${Math.min(Math.max(heading.depth, 1), 6)}` as keyof JSX.IntrinsicElements;
      return (
        <Tag key={key} className={`markdown-heading markdown-h${heading.depth}`}>
          {renderInlineTokens(heading.tokens, key)}
        </Tag>
      );
    }
    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      return (
        <p key={key}>
          {renderInlineTokens(paragraph.tokens, key)}
        </p>
      );
    }
    case 'text': {
      const textToken = token as Tokens.Text;
      return (
        <p key={key}>
          {textToken.tokens ? renderInlineTokens(textToken.tokens, key) : decodeHtmlEntities(textToken.text)}
        </p>
      );
    }
    case 'code': {
      const code = token as Tokens.Code;
      const validLang = code.lang && /^[a-zA-Z0-9_+-]*$/.test(code.lang) ? code.lang : '';
      return (
        <pre key={key} className="markdown-code-block">
          <code className={validLang ? `language-${validLang}` : undefined}>
            {code.text}
          </code>
        </pre>
      );
    }
    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      return (
        <blockquote key={key} className="markdown-blockquote">
          {quote.tokens.map((child, index) => renderBlockToken(child, `${key}-${index}`))}
        </blockquote>
      );
    }
    case 'list': {
      const list = token as Tokens.List;
      const Tag = list.ordered ? 'ol' : 'ul';
      const className = list.ordered ? 'markdown-ordered-list' : 'markdown-unordered-list';
      return (
        <Tag key={key} className={className} start={list.ordered && list.start ? Number(list.start) : undefined}>
          {list.items.map((item, index) => (
            <li key={`${key}-${index}`}>
              {item.task && (
                <input
                  type="checkbox"
                  checked={!!item.checked}
                  readOnly
                  aria-label={item.checked ? 'Completed task' : 'Incomplete task'}
                />
              )}
              {item.tokens.map((child, childIndex) => renderBlockToken(child, `${key}-${index}-${childIndex}`))}
            </li>
          ))}
        </Tag>
      );
    }
    case 'table': {
      const table = token as Tokens.Table;
      return (
        <div key={key} className="markdown-table-wrapper">
          <table className="markdown-table">
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th key={`${key}-h-${index}`} align={table.align[index] || undefined}>
                    {renderInlineTokens(cell.tokens, `${key}-h-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${key}-r-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-r-${rowIndex}-${cellIndex}`} align={table.align[cellIndex] || undefined}>
                      {renderInlineTokens(cell.tokens, `${key}-r-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'hr':
      return <hr key={key} />;
    case 'html':
      return (
        <p key={key}>
          {decodeHtmlEntities((token as Tokens.HTML).text)}
        </p>
      );
    default:
      return (
        <p key={key}>
          {decodeHtmlEntities('text' in token ? String(token.text) : token.raw)}
        </p>
      );
  }
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  isStreaming = false
}) => {
  const renderedContent = useMemo(() => {
    try {
      if (!content || !content.trim()) {
        return null;
      }

      const tokens = marked.lexer(content, markdownOptions);
      return tokens.map((token, index) => renderBlockToken(token, `md-${index}`));
    } catch (error) {
      console.error('Error rendering markdown:', error);
      return content;
    }
  }, [content]);

  if (!renderedContent && !content?.trim()) {
    return null;
  }

  return (
    <div className={`markdown-content ${className} ${isStreaming ? 'markdown-streaming' : ''}`}>
      {renderedContent}
    </div>
  );
};

export default MarkdownRenderer;
