import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { countTasks, toggleTask } from '../tasks.js';

const mdLink = { a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} /> };

// Card body Markdown (no raw HTML) whose task checkboxes can be ticked in place.
export default function SimpleMarkdown({ card, ctx }) {
  let n = 0;
  const { done, total } = countTasks(card.description);
  const components = {
    ...mdLink,
    input: ({ type, checked }) => {
      if (type !== 'checkbox') return null;
      const i = n++;
      return <input type="checkbox" checked={!!checked} disabled={!ctx.canEdit} onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()} onChange={() => ctx.setDescription(card, toggleTask(card.description, i))} />;
    },
  };
  return (
    <div className="markdown simple-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{card.description}</ReactMarkdown>
      {total > 1 && <span className={`badge ${done === total ? 'done' : 'plain'}`}>☑ {done}/{total}</span>}
    </div>
  );
}

