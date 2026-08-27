import { useId } from 'react';
import { CircleHelp } from 'lucide-react';
import './WidgetTooltip.css';

interface WidgetTooltipProps {
  text: string;
  label?: string;
}

export function WidgetTooltip({ text, label = 'About this widget' }: WidgetTooltipProps) {
  const tooltipId = useId();

  return (
    <span className="widget-tooltip">
      <button
        type="button"
        className="widget-tooltip-trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        title={text}
      >
        <CircleHelp size={15} aria-hidden="true" />
      </button>
      <span id={tooltipId} className="widget-tooltip-content" role="tooltip">
        {text}
      </span>
    </span>
  );
}
