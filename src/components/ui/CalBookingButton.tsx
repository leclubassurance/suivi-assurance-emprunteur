import React, { useEffect } from 'react';
import {
  CALCOM_CONFIG,
  CALCOM_LINK,
  CALCOM_NAMESPACE,
  ensureCalComEmbed,
} from '../../lib/calcom';
import { cn } from '../../lib/utils';

type CalBookingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export default function CalBookingButton({
  className,
  children,
  type = 'button',
  ...props
}: CalBookingButtonProps) {
  useEffect(() => {
    ensureCalComEmbed();
  }, []);

  return (
    <button
      type={type}
      data-cal-link={CALCOM_LINK}
      data-cal-namespace={CALCOM_NAMESPACE}
      data-cal-config={CALCOM_CONFIG}
      className={cn(className)}
      {...props}
    >
      {children}
    </button>
  );
}
