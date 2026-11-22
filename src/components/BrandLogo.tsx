import React from 'react';

interface BrandLogoProps {
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = 'w-8 h-8 rounded-lg' }) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="LinkVaultPro Logo"
    >
      <rect width="100" height="100" rx="22" fill="#F1F5F9" />
      {/* Outer L-frame (left & bottom) */}
      <path
        d="M12 28C12 18.0589 20.0589 10 30 10H31V72H88V72C88 81.9411 79.9411 90 70 90H30C20.0589 90 12 81.9411 12 72V28Z"
        fill="#0A0A0A"
      />
      {/* Top-right vault block with keyhole cutout */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M38 10H70C79.9411 10 88 18.0589 88 28V65H38V10ZM63 26.5C58.8579 26.5 55.5 29.8579 55.5 34C55.5 36.687 56.9125 39.0439 59.0355 40.3688L56.7 51.5H69.3L66.9645 40.3688C69.0875 39.0439 70.5 36.687 70.5 34C70.5 29.8579 67.1421 26.5 63 26.5Z"
        fill="#0A0A0A"
      />
    </svg>
  );
};
