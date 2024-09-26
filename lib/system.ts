export interface IComputed {
	get(): any;
}

export interface IEffect {
	run(): void;
	stop(): void;
}

export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

export class Link {
	prev: Link | null = null;
	next: Link | null = null;

	constructor(
		public dep: Dependency,
		public sub: Subscriber
	) { }

	break() {
		if (this.next) {
			this.next.prev = this.prev;
		}
		else {
			this.dep.lastSub = this.prev;
		}
		if (this.prev) {
			this.prev.next = this.next;
		}
		else {
			this.dep.firstSub = this.next;
		}
	}
}

export class Dependency {
	firstSub: Link | null = null;
	lastSub: Link | null = null;
	subVersion = -1;

	constructor(
		public computed: IComputed | null = null,
	) { }

	link() {
		if (activeSubsDepth - pausedSubsIndex <= 0) {
			return;
		}
		const sub = activeSub!;
		if (this.subVersion === sub.version) {
			return;
		}
		this.subVersion = sub.version;
		const old = sub.deps[sub.depsLength] as Link | undefined;
		if (old?.dep !== this) {
			old?.break();
			const newLink = new Link(this, sub);
			sub.deps[sub.depsLength++] = newLink;
			if (!this.firstSub) {
				this.firstSub = newLink;
				this.lastSub = newLink;
			}
			else {
				newLink.prev = this.lastSub;
				this.lastSub!.next = newLink;
				this.lastSub = newLink;
			}
		}
		else {
			sub.depsLength++;
		}
	}

	broadcast() {
		const queuedDeps: Dependency[] = [this];
		let dirtyLevel = DirtyLevels.Dirty;
		let i = 0;
		while (i < queuedDeps.length) {
			let link = queuedDeps[i++].firstSub;
			while (link) {
				if (link.sub.dirtyLevel === DirtyLevels.NotDirty) {
					if (link.sub.dep) {
						queuedDeps.push(link.sub.dep);
					}
					if (link.sub.effect) {
						queuedEffects.push(link.sub.effect);
					}
				}
				if (link.sub.dirtyLevel < dirtyLevel) {
					link.sub.dirtyLevel = dirtyLevel;
				}
				link = link.next;
			}
			dirtyLevel = DirtyLevels.MaybeDirty;
		}
	}
}

export class Subscriber {
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;
	trackDepth = 0;
	depsLength = 0;
	deps: Link[] = [];
	lastActiveSub: Subscriber | null = null;

	constructor(
		public dep: Dependency | null = null,
		public effect: IEffect | null = null,
	) { }

	isDirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastPausedIndex = pausedSubsIndex;
			pausedSubsIndex = activeSubsDepth;
			for (let i = 0; i < this.depsLength; i++) {
				this.deps[i].dep.computed?.get();
				if (this.dirtyLevel >= DirtyLevels.Dirty) {
					break;
				}
			}
			pausedSubsIndex = lastPausedIndex;
			if (this.dirtyLevel === DirtyLevels.QueryingDirty) {
				this.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
		return this.dirtyLevel === DirtyLevels.Dirty;
	}

	trackStart() {
		if (!this.trackDepth) {
			this.lastActiveSub = activeSub;
		}
		activeSub = this;
		activeSubsDepth++;
		this.trackDepth++;
		this.depsLength = 0;
		this.version = subVersion++;
	}

	trackEnd() {
		this.trackDepth--;
		if (this.deps.length > this.depsLength) {
			for (let i = this.depsLength; i < this.deps.length; i++) {
				this.deps[i].break();
			}
			this.deps.length = this.depsLength;
		}
		activeSubsDepth--;
		if (!this.trackDepth) {
			activeSub = this.lastActiveSub;
			this.lastActiveSub = null;
			this.dirtyLevel = DirtyLevels.NotDirty;
		}
	}
}

export const queuedEffects: IEffect[] = [];

export let activeSub: Subscriber | null = null;
export let activeSubsDepth = 0;
export let pausedSubsIndex = 0;
export let batchDepth = 0;
export let subVersion = 0;

export function setPausedSubsIndex(index: number) {
	pausedSubsIndex = index;
}

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (!batchDepth && queuedEffects.length) {
		queuedEffects.shift()!.run();
	}
}
