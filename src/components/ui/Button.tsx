import React from 'react';

export function Button({ children, className = '', size = 'md', variant = 'primary', ...props }: any) {
  const baseStyle = "inline-flex items-center justify-center font-bold rounded-2xl transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
  
  const sizeStyles: Record<string, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5",
    lg: "px-6 py-3.5 text-[15px]"
  };
  
  const variantStyles: Record<string, string> = {
    primary: "bg-[#1a1a1b] text-white hover:bg-[#333] focus:ring-[#1a1a1b]",
    outline: "border-2 border-[#e2e8f0] bg-transparent text-[#1a1a1b] hover:border-[#1a1a1b] focus:ring-[#1a1a1b]"
  };
  
  return (
    <button 
      className={`${baseStyle} ${sizeStyles[size] || sizeStyles.md} ${variantStyles[variant] || variantStyles.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
