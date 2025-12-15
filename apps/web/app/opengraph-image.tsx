import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Swarm Tools - Framework-agnostic primitives for agentic systems';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
	return new ImageResponse(
		(
			<div
				style={{
					background: 'linear-gradient(135deg, #0a0a0a 0%, #171717 50%, #0a0a0a 100%)',
					width: '100%',
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: 'monospace',
					position: 'relative',
				}}
			>
				{/* Glow effect */}
				<div
					style={{
						position: 'absolute',
						width: '800px',
						height: '400px',
						background: 'radial-gradient(ellipse, rgba(245, 158, 11, 0.15) 0%, transparent 70%)',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
					}}
				/>

				{/* ASCII Art */}
				<pre
					style={{
						color: '#f59e0b',
						fontSize: '24px',
						lineHeight: '1.1',
						textAlign: 'center',
						margin: 0,
						textShadow: '0 0 40px rgba(245, 158, 11, 0.5)',
					}}
				>
{`███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝

████████╗ ██████╗  ██████╗ ██╗     ███████╗
╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
   ██║   ██║   ██║██║   ██║██║     ███████╗
   ██║   ██║   ██║██║   ██║██║     ╚════██║
   ██║   ╚██████╔╝╚██████╔╝███████╗███████║
   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝`}
				</pre>

				{/* Tagline */}
				<p
					style={{
						color: '#a3a3a3',
						fontSize: '28px',
						marginTop: '40px',
						textAlign: 'center',
					}}
				>
					Framework-agnostic primitives for{' '}
					<span style={{ color: '#f59e0b', fontWeight: 'bold' }}>agentic systems</span>
				</p>

				{/* Bees */}
				<span
					style={{
						position: 'absolute',
						top: '60px',
						left: '100px',
						fontSize: '64px',
						opacity: 0.3,
					}}
				>
					🐝
				</span>
				<span
					style={{
						position: 'absolute',
						bottom: '80px',
						right: '120px',
						fontSize: '48px',
						opacity: 0.25,
					}}
				>
					🐝
				</span>
				<span
					style={{
						position: 'absolute',
						top: '120px',
						right: '200px',
						fontSize: '36px',
						opacity: 0.15,
					}}
				>
					🐝
				</span>
			</div>
		),
		{ ...size }
	);
}
