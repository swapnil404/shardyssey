# Shardyssey visual design

The experiment is the page. Follow the technical diagrams in PlanetScale's “Making 768 servers look like 1” and the controls in “IO devices and latency”. Do not recreate their branding or marketing layout.

- Use solid backgrounds and colours. No translucent surfaces, alpha shadows, or opacity fades. Disabled states change colour rather than becoming transparent.
- Use a neutral dark canvas, locally bundled Geist for interface text and Geist Mono for SQL, numeric data, and diagram labels. No remote font dependency. Use consistent six-pixel control corners and quiet hover/focus states; diagrams keep their hardware geometry.
- Draw database components, rather than putting an icon inside a dashboard card. Shard units are cutaway server housings with visible event cells. The router is a neutral hardware unit with a readout for its current stage, incoming query filter, routing decision, and configured shard key. Avoid a decorative chip with a generic slogan. Follow the I/O article’s grey physical components, not the blue wireframe cylinders from the sharding article.
- Hardware stays neutral grey. Blue controls select reads, green controls change distribution, and amber identifies requests and matching results. Tenant colours express ownership and remain unchanged across repartitioning.
- Keep hardware at fixed proportions. Expand desktop spacing, never stretch machines. Centre components on their connections and measure wire endpoints from their actual geometry.
- Keep idle connections dashed. Highlight only routes taken by the current query. Moving requests must follow those routes.
- Put the filter, mapping, and routing decision inside or beside the component responsible for it.
- Place controls directly above the diagram. Expose query inputs after distribution. Keep all three Plan/Route/Return explanations visible together immediately above the diagram. Playback changes the active highlight, never swaps the explanatory prose. Use one stable section heading rather than a second changing narration. Keep route notes compact and place Pause/Step beside the query inputs during playback. Allow reviewing each explanation after completion without changing the recorded result. Keep comparison below the completed run.
- Present results as a run report: identify the lookup, align compact metric columns with explicit Before/This run headers, and put the next experiment alongside on desktop. Avoid repeating the completed narration. Stack the next experiment below the report on phones.
- Use flat, readable comparison rows. No decorative stat cards, gradients, glow, oversized editorial hero, command-symbol ornament, or background texture.
- Changes in colour or motion must communicate a real change in state. Avoid decorative entrance animations.
- Show actual model counts and returned rows. The simulation uses modulo partitioning and full scans; do not imply Vitess execution or estimate production latency.
- Use the available desktop width rather than a centred narrow container. Give diagram labels and controls readable sizes and contrast; do not hide information in tiny muted text.
- Keep one continuous flow on small screens. Stack the app and router above paired shards, using one column on narrow phones. Preserve labels, keyboard controls, pause/step, and reduced-motion support.

References:
- https://planetscale.com/blog/making-768-servers-look-like-1
- https://planetscale.com/blog/io-devices-and-latency
