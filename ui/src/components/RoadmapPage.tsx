import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import roadmapContent from '../../../ROADMAP.md?raw';

export default function RoadmapPage() {
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-6 py-8">
      <div className="prose prose-sm dark:prose-invert prose-headings:font-semibold prose-a:text-blue-500 hover:prose-a:text-blue-400 max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {roadmapContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
