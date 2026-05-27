import React from 'react';

export function Input({ label, error, className = '', ...props }: any) {
  return (
    <div className={`flex flex-col space-y-1.5 ${className}`}>
      {label && <label className="text-[13px] font-bold text-slate-700">{label}</label>}
      <input 
        className={`bento-input ${error ? 'border-red-300 ring-1 ring-red-100 bg-red-50' : 'bg-white hover:border-slate-300'}`} 
        {...props} 
      />
      {error && <span className="text-[12px] text-red-500 font-medium">{error}</span>}
    </div>
  );
}

