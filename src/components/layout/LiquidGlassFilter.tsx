export function LiquidGlassFilter() {
  return (
    <svg className="absolute size-0 overflow-hidden" aria-hidden="true">
      <defs>
        <filter
          id="liquid-glass"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          {/* 1. Generate Perlin noise for displacement */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.012"
            numOctaves={1}
            seed={5}
            result="noise"
          />

          {/* 2. Remap channels to control displacement direction */}
          <feComponentTransfer in="noise" result="shaped">
            <feFuncR type="gamma" amplitude={1} exponent={10} offset={0.5} />
            <feFuncG type="gamma" amplitude={0} exponent={1} offset={0.5} />
            <feFuncB type="gamma" amplitude={0} exponent={1} offset={0.5} />
          </feComponentTransfer>

          {/* 3. Smooth the displacement map */}
          <feGaussianBlur in="shaped" stdDeviation={3} result="softMap" />

          {/* 4. Specular lighting for caustic highlights */}
          <feSpecularLighting
            in="softMap"
            surfaceScale={5}
            specularConstant={0.8}
            specularExponent={80}
            result="specLight"
          >
            <fePointLight x={-200} y={-200} z={300} />
          </feSpecularLighting>
          <feComposite
            in="specLight"
            in2="specLight"
            operator="arithmetic"
            k1={0}
            k2={1}
            k3={1}
            k4={0}
            result="litImage"
          />

          {/* 5. Displace the source graphic using the soft noise map */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="softMap"
            scale={40}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
