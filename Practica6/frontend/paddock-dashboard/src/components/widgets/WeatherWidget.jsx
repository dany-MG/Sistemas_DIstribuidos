export default function WeatherWidget({ condition }) {
    const state = condition ? condition.toLowerCase() : 'clear';

    if (state.includes('rain') || state.includes('shower') || state.includes('wet')) {
        return (
            <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-8 h-8 text-neutral-400" fill="currentColor">
                    <path d="M18.5 10A5.5 5.5 0 008 8 4 4 0 004 12a4.5 4.5 0 004.5 4.5h10a4 4 0 000-8z" />
                    <path
                        d="M10 18l-1 3m4-3l-1 3m4-3l-1 3"
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </svg>
            </div>
        );
    }

    if (state.includes('cloud') || state.includes('overcast')) {
        return (
            <div className="flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none">
                    <circle cx="10" cy="10" r="4" fill="#fbbf24" />
                    <path
                        d="M18 13a4 4 0 00-3.5-3.9 5.5 5.5 0 00-10 1.9A3.5 3.5 0 005 18h12a3 3 0 001-5z"
                        fill="#9ca3af"
                    />
                </svg>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-yellow-400" fill="currentColor">
                <circle cx="12" cy="12" r="6" />
                <path
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.364-7.364l-1.414 1.414M7.05 17.657l-1.414 1.414m12.728 0l-1.414-1.414M7.05 6.343L5.636 4.929"
                />
            </svg>
        </div>
    );
}
