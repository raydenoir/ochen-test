import { memo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { EXAMPLES, EXAMPLE_FORMATS } from '../model';
import educationPreview from '../../examples/education-album.svg?url';
import teamPreview from '../../examples/team-square.svg?url';
import savingsPreview from '../../examples/savings-square.svg?url';
import './IdeaCard.css';

const previews = [educationPreview, teamPreview, savingsPreview];

export const IdeaCard = memo(function IdeaCard({ index, disabled, onChoose }: { index: number; disabled: boolean; onChoose: (index: number) => void }) {
  const example = EXAMPLES[index];
  const { width, height } = EXAMPLE_FORMATS[index];
  return <button className="idea-card" disabled={disabled} onClick={() => onChoose(index)}>
    <span className="idea-card-preview" style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={previews[index]} alt="" loading="lazy" decoding="async" draggable={false}/>
    </span>
    <span className="idea-card-copy">
      <span className="idea-card-category">{example.tag}</span>
      <span className="idea-card-title">{example.title}</span>
      <span className="idea-card-arrow" aria-hidden="true"><ArrowUpRight size={17}/></span>
    </span>
  </button>;
});
