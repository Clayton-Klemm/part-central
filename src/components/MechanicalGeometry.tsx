function PatternHoles({ cx, cy, radius, count = 4, hole = 8 }: { cx: number; cy: number; radius: number; count?: number; hole?: number }) {
  return <>{Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count + Math.PI / 4;
    return <circle key={index} cx={cx + Math.cos(angle) * radius} cy={cy + Math.sin(angle) * radius} r={hole} className="mech-hole"/>;
  })}</>;
}

export function FamilyShape({ family, active, hatch }: { family: string; active: string | null; hatch: string }) {
  if (family === 'differential-case') return <g className="mech-body">
    <path d="M150 300V180H213V160Q230 110 350 115Q460 112 488 172H525V305H480Q460 350 350 353Q245 351 215 300Z" fill={`url(#${hatch})`}/>
    <path d="M150 214H235V266H150M465 214H525V266H465" className="mech-hole"/>
    <path d="M245 200Q259 174 292 174V287Q262 290 245 269Z" className="mech-hole"/>
    <path d="M405 174Q441 177 456 205V267Q438 288 405 287Z" className="mech-hole"/>
    <circle cx="355" cy="180" r="28" className="mech-hole"/>
    <path d="M304 294Q350 318 398 294V322Q351 340 304 322Z" className="mech-hole"/>
    <path d="M128 240H545" className="mech-axis"/>
    <g><circle cx="570" cy="335" r="65"/><circle cx="570" cy="335" r="28" className="mech-hole"/><circle cx="570" cy="335" r="50" className={`mech-pitch ${active === 'bolt-circle' ? 'mech-active-line' : ''}`}/><PatternHoles cx={570} cy={335} radius={50} hole={7} count={6}/></g>
    {active === 'bearing-bore' && <path d="M150 214H235V266H150" className="mech-selected"/>}
    {active === 'bore-diameter' && <circle cx="355" cy="180" r="28" className="mech-selected"/>}
    {active === 'outside-diameter' && <circle cx="570" cy="335" r="65" className="mech-selected"/>}
  </g>;
  if (family === 'bearing-cap') return <g className="mech-body">
    <path d="M175 340V242Q175 115 360 115Q545 115 545 242V340H475V280Q475 205 360 205Q245 205 245 280V340Z" fill={`url(#${hatch})`}/>
    <path d="M175 340H545" className="mech-datum"/>
    <rect x="198" y="261" width="24" height="79" className="mech-hole"/><rect x="498" y="261" width="24" height="79" className="mech-hole"/>
    <path d="M210 250V390M510 250V390M235 325H485" className="mech-axis"/>
    <path d="M208 265l-9 8 9 8-9 8 9 8-9 8 9 8M508 265l-9 8 9 8-9 8 9 8-9 8 9 8" className="mech-thread-line"/>
    {(active === 'bearing-bore' || active === 'wall-thickness') && <path d="M245 325V280Q245 205 360 205Q475 205 475 280V325" className="mech-selected"/>}
    {active === 'flatness' && <path d="M175 340H245M475 340H545" className="mech-active-line"/>}
    <text x="158" y="358" className="mech-small-text">A</text>
  </g>;
  if (family === 'shaft') return <g className="mech-body">
    <path d="M120 206H235V180H445V206H526V217H600V263H526V274H445V300H235V274H120Z" fill={`url(#${hatch})`}/>
    <path d="M120 206V274M235 180V300M445 180V300M526 217V263" className="mech-machining"/>
    <rect x="290" y="170" width="110" height="22" rx="5" className="mech-hole"/><path d="M545 224H600V256H545Z" className="mech-hole"/>
    <path d="M100 240H624" className="mech-axis"/>
    <path d="M545 229l9 7-9 7 9 7M570 229l9 7-9 7 9 7" className="mech-thread-line"/>
    {active === 'outside-diameter' && <path d="M120 206H235M120 274H235" className="mech-active-line"/>}
    {active === 'slot-width' && <rect x="290" y="170" width="110" height="22" rx="5" className="mech-selected"/>}
    {active === 'bore-diameter' && <path d="M545 224H600M545 256H600" className="mech-active-line"/>}
  </g>;
  if (family === 'threaded-block') return <g className="mech-body">
    <path d="M150 200L245 135H635V315L540 380H150Z" fill={`url(#${hatch})`}/>
    <path d="M150 200H540L635 135M540 200V380" className="mech-machining"/>
    <ellipse cx="300" cy="168" rx="30" ry="16" className="mech-hole"/><ellipse cx="430" cy="168" rx="30" ry="16" className="mech-hole"/>
    <ellipse cx="300" cy="168" rx="21" ry="10"/><ellipse cx="430" cy="168" rx="21" ry="10"/>
    <circle cx="260" cy="290" r="32" className="mech-hole"/><circle cx="420" cy="290" r="32" className="mech-hole"/>
    <circle cx="180" cy="340" r="7" className="mech-hole"/><circle cx="500" cy="340" r="7" className="mech-hole"/>
    <path d="M225 290H455M300 135V198M430 135V198" className="mech-axis"/>
    <rect x="175" y="225" width="340" height="129" rx="5" className="mech-machining"/>
    {active === 'bore-diameter' && <circle cx="260" cy="290" r="32" className="mech-selected"/>}
    {active === 'hole-spacing' && <><ellipse cx="300" cy="168" rx="30" ry="16" className="mech-selected"/><ellipse cx="430" cy="168" rx="30" ry="16" className="mech-selected"/></>}
  </g>;
  if (family === 'housing') return <g className="mech-body">
    <path d="M170 340L204 302L220 178Q245 102 350 102Q458 102 480 178L499 302L545 340V374H170Z" fill={`url(#${hatch})`}/>
    <path d="M205 340H510M240 168L219 340M460 168L486 340" className="mech-machining"/>
    <circle cx="350" cy="230" r="132"/><circle cx="350" cy="230" r="88" className="mech-hole"/><circle cx="350" cy="230" r="99" className="mech-machining"/>
    <circle cx="195" cy="350" r="10" className="mech-hole"/><circle cx="505" cy="350" r="10" className="mech-hole"/>
    <circle cx="350" cy="230" r="117" className="mech-pitch"/><PatternHoles cx={350} cy={230} radius={117} count={6} hole={7}/>
    <path d="M195 350H505M350 78V388" className="mech-axis"/>
    {active === 'bearing-bore' && <circle cx="350" cy="230" r="88" className="mech-selected"/>}
    {active === 'outside-diameter' && <circle cx="350" cy="230" r="132" className="mech-selected"/>}
  </g>;
  if (family === 'ring') return <g className="mech-body">
    <path d="M180 230V272A170 85 0 0 0 520 272V230Z" fill={`url(#${hatch})`}/><ellipse cx="350" cy="230" rx="170" ry="85"/><ellipse cx="350" cy="230" rx="102" ry="51" className="mech-hole"/>
    <path d="M160 230H540M350 125V345" className="mech-axis"/>
    {active === 'bore-diameter' && <ellipse cx="350" cy="230" rx="102" ry="51" className="mech-selected"/>}
  </g>;
  return <g className="mech-body">
    <circle cx="350" cy="230" r="160"/><circle cx="350" cy="230" r="83"/><circle cx="350" cy="230" r="54" className="mech-hole"/>
    <circle cx="350" cy="230" r="130" className={`mech-pitch ${active === 'bolt-circle' ? 'mech-active-line' : ''}`}/><PatternHoles cx={350} cy={230} radius={130} count={4} hole={13}/>
    <path d="M170 230H530M350 50V410" className="mech-axis"/>
    <path d="M180 380H280V365H420V380H540V415H180Z" fill={`url(#${hatch})`}/><path d="M305 365V415M395 365V415" className="mech-hole"/>
    {active === 'outside-diameter' && <circle cx="350" cy="230" r="160" className="mech-selected"/>}
    {active === 'bearing-bore' && <circle cx="350" cy="230" r="83" className="mech-selected"/>}
    {active === 'bore-diameter' && <circle cx="350" cy="230" r="54" className="mech-selected"/>}
  </g>;
}

