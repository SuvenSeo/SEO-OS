/**
 * Benchmark Script: Context Building Optimization
 * Mocks database latency to demonstrate the improvement from sequential to parallel execution.
 */

const DB_LATENCY = 100; // ms per query

// Mocks for database calls
const mockDbCall = async (name) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ data: [`data for ${name}`] });
    }, DB_LATENCY);
  });
};

// ── OLD SEQUENTIAL VERSION ──────────────────────────────────────────────
async function buildContextSequential() {
  const start = Date.now();

  await mockDbCall('episodic_memory');
  await mockDbCall('tasks');
  await mockDbCall('core_memory');
  await mockDbCall('working_memory');
  await mockDbCall('patterns');
  await mockDbCall('ideas');
  // knowledge base search is conditional, but let's assume it runs
  await mockDbCall('knowledge_base');

  return Date.now() - start;
}

// ── NEW PARALLEL VERSION ────────────────────────────────────────────────
async function buildContextParallel(cached = false) {
  const start = Date.now();

  const promises = [
    mockDbCall('episodic_memory'),
    mockDbCall('tasks'),
    cached ? Promise.resolve({ data: [] }) : mockDbCall('core_memory'),
    mockDbCall('working_memory'),
    cached ? Promise.resolve({ data: [] }) : mockDbCall('patterns'),
    cached ? Promise.resolve({ data: [] }) : mockDbCall('ideas'),
    mockDbCall('knowledge_base'),
  ];

  await Promise.all(promises);

  return Date.now() - start;
}

async function runBenchmark() {
  console.log('⚡ Starting Context Building Benchmark...');
  console.log(`📡 Mock Database Latency: ${DB_LATENCY}ms\n`);

  const sequentialTime = await buildContextSequential();
  console.log(`❌ Sequential Context Building: ${sequentialTime}ms`);

  const parallelTime = await buildContextParallel(false);
  console.log(`✅ Parallel Context Building (No Cache): ${parallelTime}ms`);

  const parallelCachedTime = await buildContextParallel(true);
  console.log(`🚀 Parallel Context Building (With Cache): ${parallelCachedTime}ms`);

  const improvement = ((sequentialTime - parallelCachedTime) / sequentialTime * 100).toFixed(1);
  console.log(`\n📈 Estimated Performance Gain: ${improvement}%`);
}

runBenchmark();
