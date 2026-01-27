const pages = [
	{ title: "Home", href: "index.html" },
	{ title: "Reference", href: "reference.html" },
	{ title: "Dashboard", href: "dashboard.html" },
	{ title: "Finder", href: "finder.html" },
	{ title: "Chat", href: "chat.html" },
	{ title: "LLM", href: "LLM.html" },
	{ title: "Calendar", href: "calendar.html" },
	{ title: "Chess", href: "chess.html" },
	{ title: "Isometric", href: "isometric.html" }
];

const toc = document.getElementById("toc");
const main = document.querySelector("main");
const siteNav = document.getElementById("site-nav");
const layout = document.getElementById("layout");

if (siteNav) {
	const list = document.createElement("ul");
	pages.forEach((page) => {
		const li = document.createElement("li");
		const link = document.createElement("a");
		link.href = page.href;
		link.textContent = page.title;
		if (window.location.pathname.endsWith(page.href)) {
			link.setAttribute("aria-current", "page");
		}
		li.appendChild(link);
		list.appendChild(li);
	});
	siteNav.appendChild(list);
}

if (layout) {
	const sideNav = layout.querySelector(":scope > nav");
	if (sideNav) {
		layout.classList.add("has-side-nav");
	}
}

if (toc && main) {
	const headings = Array.from(main.querySelectorAll("h2, h3"));
	let currentList = toc;

	headings.forEach((heading, index) => {
		if (!heading.id) {
			const slug = heading.textContent
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/(^-|-$)/g, "");
			heading.id = slug || `section-${index + 1}`;
		}

		if (heading.tagName.toLowerCase() === "h2") {
			currentList = document.createElement("ul");
			const li = document.createElement("li");
			const link = document.createElement("a");
			link.href = `#${heading.id}`;
			link.textContent = heading.textContent;
			li.appendChild(link);
			li.appendChild(currentList);
			toc.appendChild(li);
		} else if (heading.tagName.toLowerCase() === "h3") {
			const li = document.createElement("li");
			const link = document.createElement("a");
			link.href = `#${heading.id}`;
			link.textContent = heading.textContent;
			li.appendChild(link);
			currentList.appendChild(li);
		}
	});
}
