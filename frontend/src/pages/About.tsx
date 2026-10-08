import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageBackButton } from "@/components/PageBackButton";

import aboutContent from "/about.md?raw";

export default function About() {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <PageBackButton />

        <article className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {aboutContent}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
