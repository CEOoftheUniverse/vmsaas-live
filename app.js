// DEMO ONLY - mock provisioning UX. MoltBot Cloud is in pre-order: do not load this file on a live page or wire it to a form.

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
            <h3 style="color: white; margin-bottom: 0.2rem;">Demo only</h3>
            <p style="color: #94a3b8; font-size: 0.9rem;">This is a preview of the planned ${tier.toUpperCase()} setup. No VM was created: MoltBot Cloud is in pre-order.</p>
        `;
        btn.style.display = 'none';
    }, 3500);
}
