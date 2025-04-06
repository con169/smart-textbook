import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface TypewriterMessageProps {
  content: string;
  onComplete?: () => void;
}

const TypewriterMessage: React.FC<TypewriterMessageProps> = ({ content, onComplete }) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (currentIndex < content.length) {
      // Find the next LaTeX block if we're at the start of one
      let chunkSize = 1;
      const remainingContent = content.slice(currentIndex);
      
      // Check for display math block
      if (remainingContent.startsWith('$$')) {
        const endIndex = content.indexOf('$$', currentIndex + 2);
        if (endIndex !== -1) {
          chunkSize = endIndex + 2 - currentIndex;
        }
      }
      // Check for inline math block
      else if (remainingContent.startsWith('$')) {
        const endIndex = content.indexOf('$', currentIndex + 1);
        if (endIndex !== -1) {
          chunkSize = endIndex + 1 - currentIndex;
        }
      }

      const timeout = setTimeout(() => {
        setDisplayedContent(content.slice(0, currentIndex + chunkSize));
        setCurrentIndex(prev => prev + chunkSize);
      }, 20);

      return () => clearTimeout(timeout);
    } else {
      setIsComplete(true);
      if (onComplete) {
        onComplete();
      }
    }
  }, [currentIndex, content, onComplete]);

  // During typing, show plain text for math blocks
  const renderTypingContent = () => {
    let text = displayedContent;
    // Replace display math blocks with placeholder
    text = text.replace(/\$\$(.*?)\$\$/g, '(math equation)');
    // Replace inline math blocks with placeholder
    text = text.replace(/\$(.*?)\$/g, '(math)');
    return text;
  };

  return (
    <div className="markdown-content">
      {isComplete ? (
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
        >
          {content}
        </ReactMarkdown>
      ) : (
        <div className="typing-content">
          {renderTypingContent()}
        </div>
      )}
    </div>
  );
};

export default TypewriterMessage; 