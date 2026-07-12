import React from 'react';

/**
 * SmartCaptions' product logo is an isometric "S" of stacked layer plates
 * (two chevron channels over a solid diamond base). The mark keeps that
 * stacked-layers silhouette in one tintable color, depth implied by opacity
 * steps top-to-bottom (lightest floats, the base plate is solid).
 */
export const SmartCaptionsMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{color}}>
    <path d="M4 6.4 12 2.4 20 6.4 20 8.6 12 4.6 4 8.6 Z" fill="currentColor" opacity={0.55} />
    <path d="M4 10.7 12 6.7 20 10.7 20 12.9 12 8.9 4 12.9 Z" fill="currentColor" opacity={0.8} />
    <path d="M12 12.6 20.2 16.7 12 20.8 3.8 16.7 Z" fill="currentColor" />
  </svg>
);
