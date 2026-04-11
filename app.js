// Basic JS to handle the mock provisioning UX

function mockProvision() {
    const form = document.getElementById('checkoutForm');
    const status = document.getElementById('provisionStatus');
    const btn = document.querySelector('.btn-submit');
    const tier = document.getElementById('tier').value;

    // Start UI feedback
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.innerText = "Processing...";
    status.classList.remove('hidden');

    // Simulate Backend Provisioning Delay
    setTimeout(() => {
        status.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">🎉</div>
            <h3 style="color: white; margin-bottom: 0.2rem;">Deployment Successful!</h3>
            <p style="color: #94a3b8; font-size: 0.9rem;">Your MoltBot Native Windows Environment (${tier.toUpperCase()}) is booting.</p>
            <p style="color: #22d3ee; margin-top: 1rem; font-family: monospace; font-size: 1.1rem;">IP: 104.131.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}</p>
        `;
        btn.style.display = 'none';
    }, 3500);
}
