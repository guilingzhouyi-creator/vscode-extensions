/**
 * PART TREE — the contract between data and geometry.
 *   - every `id` here MUST be produced exactly once by a geometry module (enforced by tests)
 *   - geometry modules MUST NOT emit parts absent from this tree (enforced by tests)
 *   - lod: minimum detail level at which the part exists (0 fine .. 2 coarse)
 *   - bucket: the mesh detail bucket the part lands in:
 *       2 = base hull (always), 1 = +structure, 0 = +micro detail
 *   - explode: offset (m, aircraft axes) at full explode factor
 *   - mirror: 'LR' means definition authored once for the starboard side; builder
 *     instantiates the mirrored twin (rotX 180°) and rewrites the id suffix.
 *   - src: doc | der | eng — provenance class shown in the inspector.
 *   - rig: handle consumed by interaction/rig.js
 *   - optional: belongs to a swappable group (stores)
 */

const P = (id, name, name_zh, parent, o = {}) => ({
  id, name, name_zh, parent,
  lod: o.lod ?? 2, bucket: o.bucket ?? 2, mirror: o.mirror ?? null,
  explode: o.explode ?? [0, 0, 0], rig: o.rig ?? null,
  station: o.station ?? '', src: o.src ?? 'der', mass: o.mass ?? null,
  desc: o.desc ?? '', optional: o.optional ?? false, group: o.group ?? null,
  children: []
});

export const ASSEMBLIES = [
  {
    id: 'nose', name: 'Nose / Forward Fuselage', name_zh: '机头与前机身',
    explode: [0.9, 0, 0.15],
    parts: [
      P('nose.shell', 'Nose shell (GAU-8 brow)', '机头蒙皮(机炮眉脊)', 'nose', { src: 'der', station: 'STA 0.00–2.30', explode: [1.1, 0, 0.1], desc: 'Skin panels are non-load-bearing, field-replaceable (doc).' }),
      P('nose.muzzle-port', 'Muzzle ports & fairing', '炮口开口与整流罩', 'nose', { bucket: 1, src: 'doc', station: 'STA 0.35', explode: [1.5, 0, -0.2], desc: 'Firing barrel aligned with aircraft centerline; gun offset left (doc).' }),
      P('nose.access-panels', 'Forward access panels', '前部检修面板', 'nose', { bucket: 0, src: 'eng', explode: [1.3, 0.5, 0], desc: 'Avionicsbay access doors w/ fasteners (L0).' }),
      P('nose.rivets', 'Nose fastener field', '机头紧固件阵列', 'nose', { bucket: 0, src: 'eng', desc: 'Instanced fastener heads (LOD0 only).' }),
      P('nose.pitot', 'Pitot / AoA boom', '空速管/迎角传感器', 'nose', { bucket: 1, src: 'eng', station: 'STA 1.4', explode: [1.4, 0.3, 0.1] }),
      P('nose.refuel-receptacle', 'Aerial refuel receptacle', '空中加油受油口', 'nose', { bucket: 1, src: 'der', station: 'STA 3.0 R', explode: [0.4, 0.9, 0.7], desc: 'Fixed receptacle, right upper forward fuselage.' })
    ]
  },
  {
    id: 'fuselage', name: 'Fuselage Structure & Skin', name_zh: '机身结构与蒙皮',
    explode: [0, 0, 0],
    parts: [
      P('fuselage.skin-upper', 'Upper fuselage skin', '上蒙皮', 'fuselage', { src: 'der', explode: [0, 0, 1.0], desc: 'Lofted between frame stations; integral-stiffener panel concept (doc).' }),
      P('fuselage.skin-lower', 'Lower fuselage skin', '下蒙皮', 'fuselage', { src: 'der', explode: [0, 0, -0.9] }),
      P('fuselage.frames', 'Frames (bulkhead rings)', '框(隔框环)', 'fuselage', { bucket: 1, src: 'eng', station: 'pitch 0.40 m', explode: [0, 0, -1.5], desc: 'Real ring geometry inside the skin; visible in cutaway/x-ray.' }),
      P('fuselage.stringers', 'Stringers (longitudinal)', '长桁', 'fuselage', { bucket: 0, src: 'eng', explode: [0, 0, -1.5] }),
      P('fuselage.bulkheads', 'Major bulkheads', '主隔框', 'fuselage', { bucket: 1, src: 'eng', explode: [0, 1.6, -0.4] }),
      P('fuselage.spine-fairing', 'Spine fairing', '背脊整流罩', 'fuselage', { src: 'der', station: 'STA 6.2–12.4', explode: [0, 0, 0.8] }),
      P('fuselage.ventral', 'Ventral gun-bay fairing', '机腹炮舱整流罩', 'fuselage', { src: 'der', explode: [0, 0, -1.0], bucket: 1 }),
      P('fuselage.panel-seams', 'Panel seam lines (raised landings)', '板缝凸起', 'fuselage', { bucket: 0, src: 'eng', desc: 'Thin raised seam strips — geometry, not decal.' }),
      P('fuselage.rivets', 'Fuselage fastener fields', '机身紧固件', 'fuselage', { bucket: 0, src: 'eng' }),
      P('fuselage.antennas', 'VHF/UHF & GPS antennas', '通信/GPS天线', 'fuselage', { bucket: 1, src: 'eng', explode: [0, 0.2, 0.9] }),
      P('fuselage.fairing-aft.R', 'Aft fuselage side fairings', '后机身侧整流罩', 'fuselage', { mirror: 'LR', src: 'der', explode: [0.2, 0.5, 0.4] })
    ]
  },
  {
    id: 'armor', name: 'Titanium Bathtub Armor', name_zh: '钛合金装甲浴盆',
    explode: [0, 0, -2.3],
    parts: [
      P('armor.bathtub', 'Titanium armor bathtub', '装甲浴盆', 'armor', { bucket: 1, src: 'doc', station: 'STA 3.85–6.55', mass: 540, explode: [0, 0, -2.3], desc: '12.7–38 mm plates (doc); modelled as lofted inner shell.' }),
      P('armor.spall-liner', 'Nylon spall liner', '防崩衬层', 'armor', { bucket: 0, src: 'doc', explode: [0, 0, -2.0] }),
      P('armor.canopy-sill-armor', 'Windscreen armor frame', '风挡装甲框', 'armor', { bucket: 1, src: 'doc', explode: [0.3, 0, -1.8] })
    ]
  },
  {
    id: 'cockpit', name: 'Cockpit', name_zh: '座舱',
    explode: [0, 0, 2.15],
    parts: [
      P('cockpit.floor', 'Cockpit floor (antislip)', '座舱地板', 'cockpit', { bucket: 1, src: 'der' }),
      P('cockpit.seat', 'ACES II ejection seat', '弹射座椅', 'cockpit', { src: 'doc', station: 'STA 4.6', mass: 116, desc: 'Zero-zero seat; orange pan (public imagery).' }),
      P('cockpit.main-panel', 'Instrument panel', '仪表板', 'cockpit', { src: 'der', desc: 'Standby gauges + 2× MFD (A-10C, doc).' }),
      P('cockpit.mfd-left', 'MFD left', '左多功能显示器', 'cockpit', { bucket: 1, src: 'doc' }),
      P('cockpit.mfd-right', 'MFD right', '右多功能显示器', 'cockpit', { bucket: 1, src: 'doc' }),
      P('cockpit.hud', 'HUD combiner', '平视显示器', 'cockpit', { bucket: 1, src: 'der' }),
      P('cockpit.stick', 'Control stick (HOTAS)', '驾驶杆', 'cockpit', { bucket: 1, src: 'doc', desc: 'F-16 style right-hand stick (doc).' }),
      P('cockpit.throttle', 'Throttle quadrant', '油门台', 'cockpit', { bucket: 1, src: 'doc', desc: 'F-15 style left throttle (doc).' }),
      P('cockpit.pedals', 'Rudder pedals', '脚蹬', 'cockpit', { bucket: 1, src: 'der' }),
      P('cockpit.console-left', 'Left console', '左控制台', 'cockpit', { bucket: 1, src: 'der' }),
      P('cockpit.console-right', 'Right console', '右控制台', 'cockpit', { bucket: 1, src: 'der' }),
      P('cockpit.sidewalls', 'Cockpit sidewalls', '侧壁', 'cockpit', { bucket: 1, src: 'eng' }),
      P('cockpit.ejection-handles', 'Ejection handles', '弹射拉环', 'cockpit', { bucket: 0, src: 'der' }),
      P('cockpit.fire-bottle', 'Fire bottle (seat)', '座椅灭火瓶', 'cockpit', { bucket: 0, src: 'eng' })
    ]
  },
  {
    id: 'canopy', name: 'Canopy Assembly', name_zh: '舱盖组件',
    explode: [0.5, 1.6, 1.8],
    parts: [
      P('canopy.windscreen', 'Armor glass windscreen', '防弹风挡', 'canopy', { src: 'doc', desc: 'Small-arms resistant (doc).' }),
      P('canopy.bubble', 'Bubble canopy', '气泡舱盖', 'canopy', { src: 'doc', desc: 'All-around vision single-piece bubble (doc).' }),
      P('canopy.frame', 'Canopy jettison frame', '舱盖框', 'canopy', { bucket: 1, src: 'der' }),
      P('canopy.hinge', 'Right-side hinge & actuator', '右侧铰链作动筒', 'canopy', { bucket: 0, src: 'eng', rig: 'canopyHinge' }),
      P('canopy.seal', 'Door seal landings', '舱门密封面', 'canopy', { bucket: 0, src: 'eng' })
    ]
  },
  {
    id: 'gun', name: 'GAU-8/A Avenger System', name_zh: 'GAU-8/A 机炮系统',
    explode: [0, -2.5, -1.15],
    parts: [
      P('gun.barrels', '7-barrel cluster (Ø0.437 m)', '七管炮束', 'gun', { src: 'doc', mass: 281, desc: 'Barrel len 2.30 m; progressive RH twist (doc).' }),
      P('gun.carrier', 'Barrel carrier / trunnion ring', '炮管转鼓/耳轴环', 'gun', { bucket: 1, src: 'eng', rig: 'gunSpin' }),
      P('gun.receiver', 'Receiver & feed housing', '机匣与输弹机', 'gun', { bucket: 1, src: 'der' }),
      P('gun.motor-left', 'Hydraulic motor A', '液压马达A', 'gun', { bucket: 1, src: 'doc', desc: 'Twin hydraulic motors from independent systems (doc).' }),
      P('gun.motor-right', 'Hydraulic motor B', '液压马达B', 'gun', { bucket: 1, src: 'doc' }),
      P('gun.feed-upper', 'Upper feed chute', '上进弹滑槽', 'gun', { bucket: 1, src: 'der', desc: 'Linkless double-ended feed (doc).' }),
      P('gun.feed-lower', 'Lower/empty-link chute', '下滑/抛链槽', 'gun', { bucket: 1, src: 'der' }),
      P('gun.drum', 'Ammo drum (0.876 × 1.82 m)', '弹鼓', 'gun', { src: 'doc', station: 'STA 5.95', desc: '1,174 rds typical / 1,350 max (doc).' }),
      P('gun.drum-rounds', 'Rounds in drum (instanced)', '弹鼓弹药(实例化)', 'gun', { bucket: 0, src: 'doc', desc: 'Helical double row, 1,174 rounds.' }),
      P('gun.mount', 'Gun mount & cradle rails', '炮架导轨', 'gun', { bucket: 1, src: 'eng' }),
      P('gun.bay-doors', 'Gun bay access doors', '炮舱检修门', 'gun', { bucket: 1, src: 'eng', explode: [0.4, -1.0, -0.6] })
    ]
  },
  {
    id: 'wing', name: 'Wings (2-spar, straight)', name_zh: '机翼(双梁平直翼)',
    explode: [0, 0, 0],
    parts: [
      P('wing.center-box', 'Center wing box', '中央翼盒', 'wing', { src: 'der', desc: 'Runs through fuselage; WS23 junction at 0.584 m (doc).' }),
      P('wing.skin-upper.R', 'Upper skin', '上翼面蒙皮', 'wing', { mirror: 'LR', src: 'der', explode: [0, 1.9, 0.9], desc: 'Outer lower skin thickened in production history (doc).' }),
      P('wing.skin-lower.R', 'Lower skin', '下翼面蒙皮', 'wing', { mirror: 'LR', src: 'der', explode: [0, 1.9, -0.9] }),
      P('wing.le-honeycomb.R', 'Leading-edge honeycomb panel', '峰窝前缘板', 'wing', { mirror: 'LR', bucket: 1, src: 'doc', desc: 'Honeycomb LE construction (doc).' }),
      P('wing.spar-front.R', 'Front spar cap+web', '前大梁', 'wing', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('wing.spar-rear.R', 'Rear spar cap+web', '后大梁', 'wing', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('wing.ribs.R', 'Ribs', '翼肋', 'wing', { mirror: 'LR', bucket: 1, src: 'eng', desc: 'Pitch 0.62 m — real geometry, seen in cutaway.' }),
      P('wing.fuel-cell.R', 'Main fuel cell + foam', '主油箱+泡沫', 'wing', { mirror: 'LR', bucket: 1, src: 'doc', desc: '4 tanks near CG, isolated from skin, reticulated foam (doc).' }),
      P('wing.flap.R', 'Double-slotted inboard flap', '内段开缝襟翼', 'wing', { mirror: 'LR', src: 'der', rig: 'flapR', explode: [0.5, 1.3, -0.35] }),
      P('wing.flap-tracks.R', 'Flap track fairings', '襟翼滑轨整流罩', 'wing', { mirror: 'LR', bucket: 1, src: 'der', explode: [0.7, 1.2, -0.5] }),
      P('wing.aileron.R', 'Split aileron / deceleron', '分割副翼', 'wing', { mirror: 'LR', src: 'doc', rig: 'aileronR', explode: [0.55, 1.5, 0.3] }),
      P('wing.spoileron.R', 'Spoileron', '扰流副翼', 'wing', { mirror: 'LR', src: 'doc', rig: 'spoileronR', explode: [0.2, 1.4, 1.1] }),
      P('wing.tip.R', 'Hoerner wingtip', '翼尖', 'wing', { mirror: 'LR', bucket: 1, src: 'der', explode: [0, 2.3, 0] }),
      P('wing.panel-lines.R', 'Wing panel/rib trace', '翼面板缝', 'wing', { mirror: 'LR', bucket: 0, src: 'eng' }),
      P('wing.rivets.R', 'Wing fastener fields', '机翼紧固件', 'wing', { mirror: 'LR', bucket: 0, src: 'eng' })
    ]
  },
  {
    id: 'tail', name: 'Empennage (twin fin + h-stab)', name_zh: '尾翼(双垂尾+平尾)',
    explode: [1.6, 0, 0],
    parts: [
      P('tail.hstab.R', 'Horizontal stabilizer', '水平尾翼', 'tail', { id: 'tail.hstab.R', mirror: 'LR', src: 'der', explode: [0.8, 1.3, 0] }),
      P('tail.elevator.R', 'Elevator', '升降舵', 'tail', { mirror: 'LR', src: 'der', rig: 'elevatorR', explode: [1.7, 1.2, 0.15] }),
      P('tail.fin.R', 'Vertical fin', '垂直尾翼', 'tail', { mirror: 'LR', src: 'der', explode: [0.4, 1.1, 1.3] }),
      P('tail.rudder.R', 'Rudder', '方向舵', 'tail', { mirror: 'LR', src: 'der', rig: 'rudderR', explode: [1.5, 1.0, 1.5] }),
      P('tail.fin-rudder-seam.R', 'Fin panel seams', '垂尾板缝', 'tail', { mirror: 'LR', bucket: 0, src: 'eng' }),
      P('tail.tip-fin-cap.R', 'Fin tip fairing', '垂尾整流帽', 'tail', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('tail.cone', 'Tail cone', '尾锥', 'tail', { src: 'der', explode: [2.0, 0, 0], desc: 'Aft cone between fins carrying static dischargers.' }),
      P('tail.dischargers', 'Static dischargers', '静电放电刷', 'tail', { bucket: 0, src: 'eng', explode: [2.2, 0, 0] }),
      P('tail.root-fairings.R', 'H-stab root fairings', '平尾整流根', 'tail', { mirror: 'LR', bucket: 1, src: 'eng' })
    ]
  },
  {
    id: 'nacelle', name: 'Engine Nacelles & Intakes', name_zh: '发动机短舱与进气道',
    explode: [0, 0, 1.5],
    parts: [
      P('nacelle.cowl-upper.R', 'Upper cowl', '上整流罩', 'nacelle', { mirror: 'LR', src: 'der', explode: [0, 1.1, 1.2] }),
      P('nacelle.cowl-lower.R', 'Lower cowl (field doors)', '下整流罩(维护门)', 'nacelle', { mirror: 'LR', src: 'der', explode: [0, 1.1, -1.0], desc: 'Engines serviceable w/ 6-ft vehicles — clamshell doors.' }),
      P('nacelle.door-l.R', 'Nacelle access door (hinged)', '短舱检修门', 'nacelle', { mirror: 'LR', bucket: 1, src: 'eng', rig: 'nacelleDoorR', explode: [-0.2, 1.4, -0.4] }),
      P('nacelle.inlet-lip.R', 'D-section inlet lip', 'D形进气唇口', 'nacelle', { mirror: 'LR', src: 'der', explode: [-0.6, 0.7, 0.4] }),
      P('nacelle.inlet-duct.R', 'Inlet duct', '进气道', 'nacelle', { mirror: 'LR', bucket: 1, src: 'der', desc: 'Real lofted duct with FOD lip and splitter — visible interior.' }),
      P('nacelle.splitter.R', 'Fan/core splitter', '内外涵分流器', 'nacelle', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('nacelle.exhaust-lip.R', 'Exhaust lip', '喷口唇部', 'nacelle', { mirror: 'LR', src: 'der', explode: [0.7, 0.8, 0] }),
      P('nacelle.heatshield.R', 'Exhaust heat shield', '喷口隔热罩', 'nacelle', { mirror: 'LR', bucket: 1, src: 'eng', desc: 'IR masking via exhaust up/over tail (doc).' }),
      P('nacelle.pylon.R', 'Engine pylon (4-bolt)', '发动机挂架', 'nacelle', { mirror: 'LR', bucket: 1, src: 'doc', desc: 'Four bolts connect pylon to airframe (doc).' }),
      P('nacelle.pylon-bolts.R', 'Pylon bolts', '挂架螺栓', 'nacelle', { mirror: 'LR', bucket: 0, src: 'doc' }),
      P('nacelle.aft-fairing.R', 'Aft area ruling fairing', '后部面积率整流', 'nacelle', { mirror: 'LR', src: 'der', explode: [0.6, 0.6, 0.3] })
    ]
  },
  {
    id: 'engine', name: 'TF34-GE-100 Powerplant', name_zh: 'TF34-GE-100 发动机',
    explode: [-1.0, 0, 2.35],
    parts: [
      P('engine.fan.R', 'Fan (1-stage, Ø1.12 m)', '风扇', 'engine', { mirror: 'LR', src: 'doc', mass: 653, rig: 'fanR', desc: '24 blades, L0/L1 instanced.' }),
      P('engine.booster.R', 'Fan shaft/booster', '增压段', 'engine', { mirror: 'LR', bucket: 1, src: 'der' }),
      P('engine.hp-compressor.R', 'HP compressor (14-stg)', '高压压气机', 'engine', { mirror: 'LR', src: 'doc', desc: '14-stage axial (Jane\'s) — shown as 5 drum bands.' }),
      P('engine.combustor.R', 'Annular combustor', '环形燃烧室', 'engine', { mirror: 'LR', bucket: 1, src: 'doc' }),
      P('engine.fuel-nozzles.R', 'Fuel injectors (18)', '燃油喷嘴', 'engine', { mirror: 'LR', bucket: 0, src: 'doc' }),
      P('engine.hpt.R', 'HP turbine (2-stage)', '高压涡轮', 'engine', { mirror: 'LR', bucket: 1, src: 'doc' }),
      P('engine.lpt.R', 'LP turbine (4-stage)', '低压涡轮', 'engine', { mirror: 'LR', bucket: 1, src: 'doc' }),
      P('engine.core-shaft.R', 'Spools & shafts', '转轴', 'engine', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('engine.nozzelext.R', 'Core exhaust cone', '核心机喷管锥体', 'engine', { mirror: 'LR', src: 'der' }),
      P('engine.agb.R', 'Accessory gearbox', '附件机匣', 'engine', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('engine.starter.R', 'Starter', '启动机', 'engine', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('engine.pumps.R', 'Fuel/pump pack', '油泵组', 'engine', { mirror: 'LR', bucket: 0, src: 'eng' }),
      P('engine.mount-frame.R', 'Engine mount cradle', '发动机安装架', 'engine', { mirror: 'LR', bucket: 1, src: 'der' }),
      P('engine.cases.R', 'Casings & external piping', '机匣与外部管路', 'engine', { mirror: 'LR', bucket: 0, src: 'eng' })
    ]
  },
  {
    id: 'gear', name: 'Landing Gear', name_zh: '起落架',
    explode: [0, 0, 0],
    parts: [
      P('gear.nose.strut', 'Nose gear oleo strut', '前起落架支柱', 'gear', { src: 'doc', station: 'offset right (doc)', rig: 'gearNose', explode: [-0.4, 0.9, -1.2] }),
      P('gear.nose.wheel', 'Nose wheel & tire', '前轮', 'gear.nose.strut', { rig: 'wheelNose', explode: [-0.4, 0.9, -1.5] }),
      P('gear.nose.doors', 'Nose gear doors', '前起落架舱门', 'gear', { bucket: 1, src: 'eng', rig: 'doorNose', explode: [-0.6, 1.3, -0.7] }),
      P('gear.nose.bay', 'Nose wheel well', '前起落架舱', 'gear', { bucket: 1, src: 'eng', explode: [0, 0.8, -0.4] }),
      P('gear.main.strut.R', 'Main gear oleo strut', '主起落架支柱', 'gear', { mirror: 'LR', src: 'doc', rig: 'gearMainR', explode: [-0.3, 1.0, -1.2] }),
      P('gear.main.wheel.R', 'Main wheel & tire', '主轮', 'gear.main.strut.R', { mirror: 'LR', rig: 'wheelMainR', explode: [-0.3, 1.0, -1.55] }),
      P('gear.main.brakes.R', 'Brake pack', '刹车组件', 'gear', { mirror: 'LR', bucket: 0, src: 'eng' }),
      P('gear.main.doors-in.R', 'Main inner doors', '主起落架内舱门', 'gear', { mirror: 'LR', bucket: 1, src: 'eng', rig: 'doorMainInR', explode: [0, 1.5, -0.6] }),
      P('gear.main.doors-out.R', 'Main outer doors', '主起落架外舱门', 'gear', { mirror: 'LR', bucket: 1, src: 'eng', rig: 'doorMainOutR', explode: [0, 1.9, -0.6] }),
      P('gear.main.bay.R', 'Main wheel well', '主起落架舱', 'gear', { mirror: 'LR', bucket: 1, src: 'eng', desc: 'Wheels stay partially exposed when retracted (doc).' }),
      P('gear.main.actuator.R', 'Retract actuator', '收放作动筒', 'gear', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('gear.main.torque.R', 'Torque links / scissor', '抗扭撑杆', 'gear', { mirror: 'LR', bucket: 1, src: 'eng' }),
      P('gear.belt', 'Gear-up skid strips', '机腹滑橇条', 'gear', { bucket: 1, src: 'der', explode: [0, 0, -1.3] })
    ]
  },
  {
    id: 'bays', name: 'Bays, Systems & Tanks', name_zh: '舱室/系统/油箱',
    explode: [0, 0, -0.6],
    parts: [
      P('bays.gun-bay', 'Gun bay walls & armor', '炮舱壁', 'bays', { bucket: 1, src: 'eng' }),
      P('bays.avionics', 'Forward avionics bay LRUs', '前航电设备舱', 'bays', { bucket: 0, src: 'eng', desc: 'Representative LRU boxes on rails — conservative, no invented line-replaceable names.' }),
      P('bays.fuel-aft', 'Aft fuselage tanks', '后机身油箱', 'bays', { bucket: 1, src: 'doc', desc: 'Tanks isolated from skin (doc).' }),
      P('bays.sumps', 'Sump tanks (2)', '集油油箱', 'bays', { bucket: 0, src: 'doc', desc: '2 self-sealing sumps, 230 mi (doc).' }),
      P('bays.hydraulics', 'Hydraulic lines (2 redundant)', '液压管路', 'bays', { bucket: 0, src: 'doc', desc: 'Double-redundant hydraulic systems (doc).' }),
      P('bays.wiring', 'Wire bundles', '线束', 'bays', { bucket: 0, src: 'eng' }),
      P('bays.bleed-ducts', 'Bleed air ducts', '引气管路', 'bays', { bucket: 1, src: 'eng' }),
      P('bays.firewall', 'Engine firewalls', '防火墙', 'bays', { bucket: 1, src: 'doc', desc: 'Engines shielded by firewalls + extinguisher (doc).' })
    ]
  },
  {
    id: 'hardpoints', name: 'Weapons Stations & Stores', name_zh: '挂点与外挂',
    explode: [0, 0, -1.6],
    parts: [
      P('hp.pylon', 'Weapon pylons (BRU class)', '挂架(武器站)', 'hardpoints', { bucket: 2, src: 'der', explode: [0, 0, -0.7], desc: '11 stations: 8 wing + 3 fuselage (doc). Group node: one mesh per station.' }),
      P('hp.rail', 'Missile launcher rails', '发射滑轨', 'hardpoints', { bucket: 2, src: 'der', explode: [0, 0, -0.7] }),
      P('hp.store.mk82', 'Mk-82 Snakeye bombs', 'Mk-82低阻炸弹', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0, 0, -1.5] }),
      P('hp.store.ter', 'Triple ejector racks', '三联挂弹架', 'hardpoints', { bucket: 2, src: 'eng', optional: true, group: 'stores', explode: [0, 0, -1.2] }),
      P('hp.store.aim9', 'AIM-9 Sidewinders', '响尾蛇导弹', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0, 0.4, -1.5] }),
      P('hp.store.rocket-pod', 'LAU-68 rocket pods', '火箭发射巢', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0, 0.3, -1.5] }),
      P('hp.store.alq131', 'ALQ-131 ECM pod', '电子战吊舱', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0.5, 0.4, -1.6] }),
      P('hp.store.litening', 'LITENING ATP pod', '瞄准吊舱', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0.4, 0.2, -1.4] }),
      P('hp.store.maverick', 'AGM-65 Mavericks', '小牛导弹', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0, 0.35, -1.5] }),
      P('hp.store.tank600', '600-gal test tank', '600加仑副油箱', 'hardpoints', { bucket: 2, src: 'doc', optional: true, group: 'stores', explode: [0, 0, -1.6], desc: '600-gal external tank flight-tested config (doc); centerline only.' })
    ]
  }
];

/** flatten to lookup used by builder/picker/UI */
export function flattenParts() {
  const out = [];
  for (const a of ASSEMBLIES) for (const p of a.parts) out.push({ ...p, assembly: a.id });
  return out;
}
/** full id → def map INCLUDING implicit .L mirror twins (side flags) */
export const PART_REGISTRY = (() => {
  const m = new Map();
  for (const p of flattenParts()) {
    if (p.mirror === 'LR') {
      m.set(p.id, { ...p, side: 'R' });
      m.set(p.id.replace(/\.R$/, '.L'), { ...p, id: p.id.replace(/\.R$/, '.L'), side: 'L', mirrorOf: p.id });
    } else m.set(p.id, p);
  }
  return m;
})();
export function assemblyMap() {
  const m = new Map();
  for (const a of ASSEMBLIES) m.set(a.id, a);
  return m;
}

/** LOD distance policy (world units) for auto mode */
export const LOD_POLICY = { levels: [14, 34], near: 0, mid: 1, far: 2, unit: 'm', basis: 'camera-to-origin distance' };
