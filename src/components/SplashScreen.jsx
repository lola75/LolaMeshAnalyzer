import React, { useState, useEffect } from 'react'

const SOCIETY_NAME = 'INTERNATIONAL SOCIETY OF DIGITAL DENTISTRY AND GUIDED SURGERY'

export default function SplashScreen({ onComplete }) {
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true)
      setTimeout(() => {
        onComplete()
      }, 500)
    }, 3500)

    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-white via-slate-50 to-slate-100 transition-opacity duration-500 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Sfondo decorativo */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-sky-400 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-blob"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-slate-300 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-sky-300 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-blob animation-delay-4000"></div>
      </div>

      {/* Contenuto moderno */}
      {/* Foto, riquadro e scritta impilati nel flusso: restano sempre dentro lo schermo */}
      <div className="relative z-10 flex max-h-full w-full items-center justify-center overflow-y-auto px-6 py-4">
        <div className="relative flex w-full max-w-6xl flex-col items-center">
          <div className="relative z-50 -mb-28 md:-mb-36 [@media(max-height:820px)]:-mb-20">
            <div className="rounded-full p-2 md:p-3 bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600 shadow-2xl">
              <div className="w-56 h-56 md:w-72 md:h-72 [@media(max-height:820px)]:w-40 [@media(max-height:820px)]:h-40 rounded-full overflow-hidden bg-white/5 backdrop-blur-sm">
                <img
                  src="/Lola.jpg"
                  alt="Lola"
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect fill="%23eef2ff" width="100%" height="100%"/><g fill="%238aa0ff"><circle cx="64" cy="44" r="24"/><path d="M16 112c0-26 24-46 48-46s48 20 48 46z"/></g></svg>'; }}
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl pt-36 md:pt-44 pb-14 px-12 shadow-lg text-center animate-fadeInUp [@media(max-height:820px)]:pt-28 [@media(max-height:820px)]:pb-8">
            <div>
              <h1 className="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-sky-600">
                LolaMeshAnalyzer
              </h1>
              <p className="mt-4 text-base md:text-xl text-slate-600 max-w-3xl mx-auto md:whitespace-nowrap">
                Visualizza e analizza modelli 3D professionali con strumenti avanzati e interfaccia intuitiva.
              </p>

              <div className="mt-6 flex items-center justify-center gap-3">
                <span className="inline-block px-3 py-1 rounded-full bg-slate-100 text-xs text-slate-700 tracking-wide">Creato da Dr. David Cao</span>
                <span className="inline-block w-1 h-1 rounded-full bg-slate-300" />
                <span className="text-xs text-slate-500">ISDIDEGS</span>
              </div>

              <div className="mt-8 w-64 h-1 rounded-full mx-auto overflow-hidden bg-gradient-to-r from-slate-200 to-slate-100">
                <div className="h-full bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600 animate-loadingBarSmooth"></div>
              </div>

              <p className="mt-6 text-xs text-slate-500 mx-auto leading-relaxed whitespace-nowrap">Avvertenza: l'app è destinata agli associati ISDIDEGS in regola con l'iscrizione. L'uso improprio è perseguibile a norma di legge.</p>
            </div>
          </div>

          {/* Nome della società: lettere che compaiono in sequenza, poi riflesso luminoso */}
          <div className="mt-10 w-full text-center [@media(max-height:820px)]:mt-6" aria-label={SOCIETY_NAME}>
            <p className="society-name flex flex-wrap justify-center gap-x-[0.6em] gap-y-2 text-lg md:text-2xl lg:text-3xl font-extrabold tracking-[0.18em]" aria-hidden="true">
              {SOCIETY_NAME.split(' ').map((word, wordIndex, words) => {
                const offset = words.slice(0, wordIndex).join('').length + wordIndex
                return (
                  <span key={wordIndex} className="whitespace-nowrap">
                    {word.split('').map((letter, letterIndex) => (
                      <span
                        key={letterIndex}
                        className="society-letter inline-block"
                        style={{ animationDelay: `${0.6 + (offset + letterIndex) * 0.03}s, ${2.2 + (offset + letterIndex) * 0.035}s` }}
                      >
                        {letter}
                      </span>
                    ))}
                  </span>
                )
              })}
            </p>
            <div className="society-underline mx-auto mt-4 h-[2px] w-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent" />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes letterIn {
          0% {
            opacity: 0;
            transform: translateY(18px) scale(0.6) rotateX(70deg);
            filter: blur(6px);
          }
          70% {
            opacity: 1;
            transform: translateY(-3px) scale(1.08) rotateX(0deg);
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes letterGlow {
          0%, 60%, 100% {
            color: #0b3a66;
            text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
          }
          30% {
            color: #38bdf8;
            text-shadow: 0 0 14px rgba(56, 189, 248, 0.75);
          }
        }

        @keyframes underlineGrow {
          from { width: 0; opacity: 0; }
          to { width: min(90%, 900px); opacity: 1; }
        }

        .society-name {
          perspective: 600px;
          color: #0b3a66;
        }

        .society-letter {
          opacity: 0;
          animation: letterIn 0.55s cubic-bezier(.2,.9,.3,1.2) both, letterGlow 2s ease-in-out infinite;
        }

        .society-underline {
          animation: underlineGrow 1.2s ease-out 2.1s forwards;
        }

        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }

        @keyframes loadingBar {
          0% {
            transform: scaleX(0);
            transform-origin: left;
          }
          100% {
            transform: scaleX(1);
            transform-origin: left;
          }
        }

        .animate-fadeInDown {
          animation: fadeInDown 0.8s ease-out 0.2s both;
        }

        .animate-fadeInUp {
          animation: fadeInUp 0.8s ease-out 0.4s both;
        }

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }

        .animate-loadingBar {
          animation: loadingBar 3s ease-in-out forwards;
        }

        .animate-loadingBarSmooth {
          animation: loadingBar 4s cubic-bezier(.2,.9,.2,1) infinite;
          background-size: 200% 100%;
        }

        @keyframes floaty {
          0% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
          100% { transform: translateY(0); }
        }

        .animate-floaty {
          animation: floaty 6s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
