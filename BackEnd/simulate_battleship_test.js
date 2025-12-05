import { io } from 'socket.io-client';

function makeSocket(userId, name) {
  return io('http://localhost:3000', {
    extraHeaders: { cookie: `userId=${userId}` },
    transports: ['websocket']
  });
}

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async function(){
  console.log('Starting simulation');
  const host = makeSocket('host1','Host');
  host.on('connect', ()=>console.log('[HOST] connected', host.id));
  host.on('game-created', (d)=>console.log('[HOST] game-created', d));
  host.on('assign-role', (r)=>console.log('[HOST] assign-role', r));
  host.on('sync-board', (b)=>console.log('[HOST] sync-board phase=', b.phase, 'turn=', b.turn));
  host.on('placed-ships', (d)=>console.log('[HOST] placed-ships', d));
  host.on('all-players-info', (p)=>console.log('[HOST] all-players-info', p));
  host.on('player-left', (p)=>console.log('[HOST] player-left', p));
  host.on('attack-result', (d)=>console.log('[HOST] attack-result', d));
  host.on('game-over', (d)=>console.log('[HOST] game-over', d));
  host.on('action-error', (e)=>console.log('[HOST] action-error', e));

  // create a game as host
  host.emit('create-game', { gameType: 'sinkEm' });

  let roomId = null;
  host.on('game-created', (d)=>{ roomId = d.roomId; console.log('[HOST] got roomId', roomId); });

  // wait for roomId
  while(!roomId) await delay(100);
  await delay(200);

  // now connect joiner
  const joiner = makeSocket('join1','Joiner');
  joiner.on('connect', ()=>console.log('[JOINER] connected', joiner.id));
  joiner.on('assign-role', (r)=>console.log('[JOINER] assign-role', r));
  joiner.on('game-joined', (d)=>console.log('[JOINER] game-joined', d));
  joiner.on('sync-board', (b)=>console.log('[JOINER] sync-board phase=', b.phase, 'turn=', b.turn));
  joiner.on('placed-ships', (d)=>console.log('[JOINER] placed-ships', d));
  joiner.on('all-players-info', (p)=>console.log('[JOINER] all-players-info', p));
  joiner.on('player-left', (p)=>console.log('[JOINER] player-left', p));
  joiner.on('attack-result', (d)=>console.log('[JOINER] attack-result', d));
  joiner.on('game-over', (d)=>console.log('[JOINER] game-over', d));
  joiner.on('action-error', (e)=>console.log('[JOINER] action-error', e));

  // joiner joins
  joiner.emit('join-room', roomId);
  joiner.emit('join-game', roomId);
  joiner.emit('ready-for-sync', roomId);

  // both request sync explicitly
  host.emit('ready-for-sync', roomId);

  await delay(500);

  // Prepare valid layouts for host (red) and joiner (blue)
  const redLayout = [
    { name: 'Carrier', x:0, y:0, dir:'H' },
    { name: 'Warship', x:0, y:1, dir:'H' },
    { name: 'Cruiser', x:0, y:2, dir:'H' },
    { name: 'Submarine', x:0, y:3, dir:'H' },
    { name: 'Destroyer', x:0, y:4, dir:'H' }
  ];
  const blueLayout = [
    { name: 'Carrier', x:0, y:5, dir:'H' },
    { name: 'Warship', x:0, y:6, dir:'H' },
    { name: 'Cruiser', x:0, y:7, dir:'H' },
    { name: 'Submarine', x:0, y:8, dir:'H' },
    { name: 'Destroyer', x:0, y:9, dir:'H' }
  ];

  // Host submits ships
  console.log('[TEST] Host placing ships');
  host.emit('place-ships', { roomId, layout: redLayout });

  await delay(500);
  console.log('[TEST] Joiner placing ships');
  joiner.emit('place-ships', { roomId, layout: blueLayout });

  // wait to observe syncs
  await delay(2000);

  console.log('[TEST] Simulating host attack (0,5) - should hit Carrier')
  host.emit('attack', { roomId, x:0, y:5 });

  await delay(1000);

  console.log('[TEST] Simulating joiner attack (0,0) - should hit')
  joiner.emit('attack', { roomId, x:0, y:0 });

  await delay(2000);

  // End
  console.log('Simulation complete. Closing sockets.');
  host.close();
  joiner.close();
  process.exit(0);
})();
