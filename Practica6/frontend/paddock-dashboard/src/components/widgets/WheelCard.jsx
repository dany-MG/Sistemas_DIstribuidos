const getTyreTempColor = (tempC) => {
    if (tempC < 60) return 'text-sky-400 border-sky-500/30 bg-sky-500/10';
    if (tempC <= 95) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    return 'text-red-400 border-red-500/30 bg-red-500/10';
};

const getBrakeTempColor = (tempC) => {
    if (tempC < 250) return 'text-sky-300';
    if (tempC <= 650) return 'text-amber-400';
    return 'text-red-400';
};

export default function WheelCard({ label, tyreTemp = 0, brakeTemp = 0, wear = 0, pressure = 0 }) {
    const tempStyle = getTyreTempColor(tyreTemp);
    const brakeStyle = getBrakeTempColor(brakeTemp);
    const wearClamped = Math.max(0, Math.min(100, wear));

    return (
        <div className="bg-neutral-950 rounded border border-neutral-800 p-2 sm:p-2.5 flex flex-col justify-between gap-2 min-w-0">
            <div className="flex justify-between items-center gap-1 border-b border-neutral-800/80 pb-1">
                <span className="text-[9px] sm:text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider truncate">
                    {label}
                </span>
                <span className="text-[9px] sm:text-[10px] font-mono text-neutral-400 shrink-0">{pressure.toFixed(1)} kPa</span>
            </div>

            <div className="grid grid-cols-2 gap-1 sm:gap-1.5 items-center my-0.5">
                <div className={`rounded border px-1 sm:px-2 py-1 text-center ${tempStyle}`}>
                    <div className="text-[8px] sm:text-[9px] font-mono uppercase opacity-75">Tyre</div>
                    <div className="text-xs sm:text-sm font-mono font-bold">{tyreTemp.toFixed(1)}°C</div>
                </div>
                <div className="rounded border border-neutral-800 bg-neutral-900/60 px-1 sm:px-2 py-1 text-center">
                    <div className="text-[8px] sm:text-[9px] font-mono uppercase text-neutral-500">Brake</div>
                    <div className={`text-xs sm:text-sm font-mono font-semibold ${brakeStyle}`}>{brakeTemp.toFixed(0)}°C</div>
                </div>
            </div>

            <div>
                <div className="flex justify-between text-[9px] font-mono text-neutral-400 mb-1">
                    <span>VIDA NEUMÁTICO</span>
                    <span className={wearClamped < 40 ? 'text-red-400 font-bold' : 'text-neutral-200'}>
                        {wearClamped.toFixed(1)}%
                    </span>
                </div>
                <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-200 ${
                            wearClamped > 60
                                ? 'bg-emerald-500'
                                : wearClamped > 30
                                ? 'bg-amber-400'
                                : 'bg-red-500'
                        }`}
                        style={{ width: `${wearClamped}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
