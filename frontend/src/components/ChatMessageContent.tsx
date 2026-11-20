import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Render model output as Markdown without executing embedded HTML. */
export function ChatMessageContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-[15px] font-normal leading-7 text-duo-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          h1: ({ children }) => <h3 className="mb-2 mt-3 text-base font-extrabold first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-2 mt-3 text-base font-extrabold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-2 mt-3 font-extrabold first:mt-0">{children}</h4>,
          h4: ({ children }) => <h4 className="mb-2 mt-3 font-extrabold first:mt-0">{children}</h4>,
          h5: ({ children }) => <h5 className="mb-2 mt-3 font-extrabold first:mt-0">{children}</h5>,
          h6: ({ children }) => <h6 className="mb-2 mt-3 font-extrabold first:mt-0">{children}</h6>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children, start }) => <ol start={start} className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:mb-1">{children}</li>,
          a: ({ children, href }) => href && /^https?:\/\//i.test(href)
            ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-duo-blue underline underline-offset-2">{children}</a>
            : <span>{children}</span>,
          // Model-provided remote images are omitted; citations remain available below.
          img: () => null,
          blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 border-duo-green pl-3 text-duo-mute last:mb-0">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-white/70 px-1 font-mono text-xs">{children}</code>,
          pre: ({ children }) => <pre className="mb-3 max-w-full overflow-x-auto rounded-lg bg-white/70 p-2 last:mb-0">{children}</pre>,
          table: ({ children }) => <div className="mb-3 max-w-full overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
          th: ({ children }) => <th className="border border-duo-mute/30 px-2 py-1 font-extrabold">{children}</th>,
          td: ({ children }) => <td className="border border-duo-mute/30 px-2 py-1 align-top">{children}</td>,
          hr: () => <hr className="my-3 border-duo-mute/30" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
