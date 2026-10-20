/**
 * The Webform component's browser side (ADR 0001 §4): proof of work and sending. When a visitor starts
 * filling a form in, it fetches a challenge and solves it in a Web Worker (SHA-256 with Web Crypto: find
 * a number whose hash with the challenge starts with enough zero bits), so the answer is usually ready
 * by the time they press Send. It then sends the form with fetch and shows the result: errors next to
 * their fields (and focus on the first), the thank-you message, or a page to go to. A challenge is used
 * once; after any answer a new one is prepared.
 */

interface Challenge {
	salt: string;
	difficulty: number;
	token: string;
}

// The worker's code, as a string (no separate file to bundle or serve).
const WORKER = `
const zeros = (bytes) => {
	let bits = 0;
	for (const b of bytes) {
		if (b === 0) { bits += 8; continue; }
		return bits + Math.clz32(b) - 24;
	}
	return bits;
};
self.onmessage = async (event) => {
	const { salt, difficulty } = event.data;
	const encoder = new TextEncoder();
	for (let nonce = 0; nonce < 1e9; nonce++) {
		const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(salt + ':' + nonce)));
		if (zeros(hash) >= difficulty) { self.postMessage(String(nonce)); return; }
	}
};
`;

let workerUrl: string | null = null;

function solve(challenge: Challenge): Promise<string> {
	workerUrl ??= URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
	return new Promise((resolve, reject) => {
		const worker = new Worker(workerUrl as string);
		const stop = setTimeout(() => {
			worker.terminate();
			reject(new Error('timeout'));
		}, 60_000);
		worker.onmessage = (event) => {
			clearTimeout(stop);
			worker.terminate();
			resolve(String(event.data));
		};
		worker.onerror = (event) => {
			clearTimeout(stop);
			worker.terminate();
			reject(new Error(event.message));
		};
		worker.postMessage({ salt: challenge.salt, difficulty: challenge.difficulty });
	});
}

async function prepare(formId: string): Promise<{ token: string; nonce: string } | null> {
	try {
		const response = await fetch(`/_webforms/challenge?form=${encodeURIComponent(formId)}`, { cache: 'no-store' });
		if (!response.ok) return null;
		const challenge = (await response.json()) as Challenge;
		return { token: challenge.token, nonce: await solve(challenge) };
	} catch {
		return null;
	}
}

function setUp(form: HTMLFormElement): void {
	const formId = form.dataset.webform as string;
	const status = form.querySelector<HTMLElement>('[data-webform-status]');
	const button = form.querySelector<HTMLButtonElement>('[data-webform-submit]');
	let proof: Promise<{ token: string; nonce: string } | null> | null = null;
	const start = () => {
		proof ??= prepare(formId);
	};
	form.addEventListener('focusin', start, { once: true });
	form.addEventListener('input', start, { once: true });

	const clearErrors = () => {
		for (const error of form.querySelectorAll<HTMLElement>('[data-webform-error]')) {
			error.hidden = true;
			error.textContent = '';
		}
		for (const input of form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
	};

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (button?.disabled) return;
		clearErrors();
		if (button) {
			button.disabled = true;
			button.dataset.label ??= button.textContent ?? 'Send';
			button.textContent = 'Sending…';
		}
		if (status) status.textContent = '';
		try {
			start();
			const answer = await proof;
			proof = null;
			const data = new FormData(form);
			data.set('_pow', answer?.token ?? '');
			data.set('_nonce', answer?.nonce ?? '');
			const response = await fetch(form.action, {
				method: 'POST',
				body: data,
				headers: { Accept: 'application/json' },
			});
			const body = (await response.json().catch(() => null)) as {
				ok?: boolean;
				message?: string;
				redirect?: string;
				errors?: Record<string, string>;
			} | null;
			if (body?.ok) {
				if (body.redirect) {
					window.location.assign(body.redirect);
					return;
				}
				const thanks = document.createElement('p');
				thanks.className = 'webform__thanks';
				thanks.setAttribute('role', 'status');
				thanks.tabIndex = -1;
				thanks.dataset.webformThanks = '';
				thanks.textContent = body.message || form.dataset.webformThanksText || 'Thank you.';
				form.replaceChildren(thanks);
				thanks.focus();
				return;
			}
			let first: HTMLElement | null = null;
			for (const [fieldId, message] of Object.entries(body?.errors ?? {})) {
				const error = form.querySelector<HTMLElement>(`[data-webform-error="${CSS.escape(fieldId)}"]`);
				if (error) {
					error.textContent = message;
					error.hidden = false;
				}
				const inputs = form.querySelectorAll<HTMLElement>(`[name="${CSS.escape(fieldId)}"]`);
				for (const input of inputs) input.setAttribute('aria-invalid', 'true');
				first ??= inputs[0] ?? null;
			}
			if (status) status.textContent = body?.message ?? 'Your submission could not be sent. Please try again.';
			first?.focus();
		} catch {
			if (status) status.textContent = 'Your submission could not be sent. Please check your connection and try again.';
		} finally {
			if (button?.isConnected) {
				button.disabled = false;
				button.textContent = button.dataset.label ?? 'Send';
			}
			// A challenge is used once: prepare the next one (unless the form was replaced by the thanks).
			if (button?.isConnected) start();
		}
	});
}

export function setUpWebforms(): void {
	for (const form of document.querySelectorAll<HTMLFormElement>('form[data-webform]')) {
		if (form.dataset.webformReady) continue;
		form.dataset.webformReady = '';
		setUp(form);
	}
}
