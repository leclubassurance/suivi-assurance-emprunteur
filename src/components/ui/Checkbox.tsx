import React from 'react';

export function Checkbox({ label, disabled, ...props }: any) {
  return (
    <label className={`flex items-start space-x-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <div className="flex items-center h-5 mt-0.5">
        <input 
          type="checkbox" 
          className="w-5 h-5 text-blue-600 rounded-[6px] border-2 border-slate-200 focus:ring-blue-600 focus:ring-2 focus:ring-offset-2 transition-colors flex-shrink-0 cursor-pointer disabled:cursor-not-allowed bg-white" 
          disabled={disabled}
          {...props} 
        />
      </div>
      <span className="text-[14px] text-slate-700 font-medium leading-normal select-none">{label}</span>
    </label>
  );
}

