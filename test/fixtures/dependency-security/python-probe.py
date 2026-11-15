import asyncio
import httpx
from opentelemetry import trace
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from langgraph_sdk._async.http import HttpClient
from langgraph_sdk._async.threads import ThreadsClient
from langgraph_sdk._sync.http import SyncHttpClient
from langgraph_sdk._sync.threads import SyncThreadsClient

THREAD_ID = '../assistants/a/graph#'
ASSISTANT_ID = '../../other/path#'
STATE_PATH = '/threads/..%2Fassistants%2Fa%2Fgraph%23/state'
GRAPH_PATH = '/assistants/..%2F..%2Fother%2Fpath%23/graph'

def handler(paths):
    def respond(request):
        if request.method == 'GET':
            paths.append(request.url.raw_path.decode('ascii'))
            return httpx.Response(200, json={'values': {'ok': True}, 'next': [], 'tasks': []})
        return httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=b'')
    return respond

def check_sync():
    paths = []
    with httpx.Client(transport=httpx.MockTransport(handler(paths)), base_url='https://example.com') as raw:
        client = SyncThreadsClient(SyncHttpClient(raw))
        with client.stream(thread_id=THREAD_ID, assistant_id=ASSISTANT_ID) as thread:
            assert thread.output == {'ok': True}
            thread.agent.get_tree()
    assert paths == [STATE_PATH, GRAPH_PATH], paths

async def check_async_impl():
    paths = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler(paths)), base_url='https://example.com') as raw:
        client = ThreadsClient(HttpClient(raw))
        async with client.stream(thread_id=THREAD_ID, assistant_id=ASSISTANT_ID) as thread:
            assert await thread.output == {'ok': True}
            await thread.agent.get_tree()
    assert paths == [STATE_PATH, GRAPH_PATH], paths

def check_async():
    asyncio.run(check_async_impl())

def check_traceparent():
    propagator = TraceContextTextMapPropagator()
    normal = '00-' + '1' * 32 + '-' + '2' * 16 + '-01'
    assert trace.get_current_span(propagator.extract({'traceparent': normal})).get_span_context().is_valid
    oversized = '01-' + '1' * 32 + '-' + '2' * 16 + '-01-' + 'a' * 520
    assert not trace.get_current_span(propagator.extract({'traceparent': oversized})).get_span_context().is_valid
    malformed = normal + ' ' * 520 + '\n'
    assert not trace.get_current_span(propagator.extract({'traceparent': malformed})).get_span_context().is_valid

failures = []
for check in [check_sync, check_async, check_traceparent]:
    try:
        check()
        print('PASS', check.__name__)
    except Exception as exc:
        failures.append(check.__name__)
        print('FAIL', check.__name__, repr(exc))
raise SystemExit(bool(failures))
