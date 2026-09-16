import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import './WidgetTooltip.css';

interface WidgetTooltipProps {
  text: string;
  label?: string;
}

interface TooltipPosition {
  top: number | 'auto';
  right: 'auto';
  bottom: number | 'auto';
  left: number;
}

export function WidgetTooltip({ text, label = 'About this widget' }: WidgetTooltipProps) {
  const tooltipId = useId();
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const showTooltip = (trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const tooltipWidth = Math.min(280, Math.max(0, window.innerWidth - viewportPadding * 2));
    const centeredLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
    const left = Math.min(
      Math.max(viewportPadding, centeredLeft),
      Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding),
    );

    if (window.innerHeight - rect.bottom >= 170) {
      setPosition({ top: rect.bottom + 6, right: 'auto', bottom: 'auto', left });
    } else {
      setPosition({ top: 'auto', right: 'auto', bottom: window.innerHeight - rect.top + 6, left });
    }
  };

  return (
    <span className="widget-tooltip" onMouseLeave={() => setPosition(null)}>
      <button
        type="button"
        className="widget-tooltip-trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        onMouseEnter={event => showTooltip(event.currentTarget)}
        onFocus={event => showTooltip(event.currentTarget)}
        onBlur={() => setPosition(null)}
      >
        <CircleHelp size={15} aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <span
            id={tooltipId}
            className="widget-tooltip-content widget-tooltip-content-fixed"
            style={position}
            role="tooltip"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
