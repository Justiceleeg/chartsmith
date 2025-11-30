/**
 * Fuzzy match tests, ported from pkg/llm/string_replacement_test.go
 */

import { performStringReplacement } from '../fuzzy-match';

describe('performStringReplacement', () => {
  interface TestCase {
    name: string;
    content: string;
    oldStr: string;
    newStr: string;
    wantContent: string;
    wantSuccess: boolean;
    wantErrContent?: string;
  }

  const tests: TestCase[] = [
    {
      name: 'Simple match case',
      content: 'Hello, world! This is a test.',
      oldStr: 'Hello, world!',
      newStr: 'Greetings, planet!',
      wantContent: 'Greetings, planet! This is a test.',
      wantSuccess: true,
    },
    {
      name: 'String not found - short string below fuzzy threshold',
      content: 'Hello, world! This is a test.',
      oldStr: "This text doesn't exist",
      newStr: 'Replacement text',
      wantContent: 'Hello, world! This is a test.', // Content should remain unchanged
      wantSuccess: false,
      wantErrContent: 'Approximate match for replacement not found',
    },
    {
      name: 'Multiple replacements',
      content: 'The quick brown fox jumps over the lazy dog. The quick brown fox is quick.',
      oldStr: 'quick',
      newStr: 'fast',
      wantContent: 'The fast brown fox jumps over the lazy dog. The fast brown fox is fast.',
      wantSuccess: true,
    },
    {
      name: 'Replace with empty string',
      content: 'Hello, world! This is a test.',
      oldStr: 'This is ',
      newStr: '',
      wantContent: 'Hello, world! a test.',
      wantSuccess: true,
    },
    // Fuzzy matching boundary tests
    {
      name: 'String exactly at 50 char minimum - not found',
      content: 'Some content that does not contain the search text',
      oldStr: '12345678901234567890123456789012345678901234567890', // exactly 50 chars
      newStr: 'replacement',
      wantContent: 'Some content that does not contain the search text',
      wantSuccess: false,
      wantErrContent: 'Approximate match for replacement not found',
    },
    {
      name: 'String below 50 char minimum - fuzzy matching skipped',
      content: 'Some content here',
      oldStr: '1234567890123456789012345678901234567890123456789', // 49 chars
      newStr: 'replacement',
      wantContent: 'Some content here',
      wantSuccess: false,
      wantErrContent: 'Approximate match for replacement not found',
    },
    // Actual fuzzy matching tests - these test the fuzzy algorithm
    {
      name: 'Fuzzy match fails with trailing whitespace difference - fuzzy matcher does not normalize whitespace',
      content: `apiVersion: v2
name: wordpress
version: 1.0.0
description: A chart for WordPress deployment on Kubernetes`,
      oldStr: `apiVersion: v2
name: wordpress
version: 1.0.0
description: A chart for WordPress deployment on Kubernetes  `, // trailing spaces cause mismatch
      newStr: `apiVersion: v2
name: wordpress
version: 2.0.0
description: Updated WordPress chart`,
      wantContent: `apiVersion: v2
name: wordpress
version: 1.0.0
description: A chart for WordPress deployment on Kubernetes`, // unchanged - no match found
      wantSuccess: false,
      wantErrContent: 'Approximate match for replacement not found',
    },
    {
      name: 'No match when strings are completely different and long',
      content: 'This is a completely different piece of content that has nothing in common with the search string at all and is quite long',
      oldStr: 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore',
      newStr: 'replacement',
      wantContent: 'This is a completely different piece of content that has nothing in common with the search string at all and is quite long',
      wantSuccess: false,
      wantErrContent: 'Approximate match for replacement not found',
    },
    // This test exercises actual fuzzy matching where the search string is a subset of content
    {
      name: 'Fuzzy match succeeds when content contains oldStr plus extra text',
      content: `# Header comment
apiVersion: v2
name: wordpress
version: 1.0.0
description: A chart for WordPress deployment on Kubernetes
# This is a footer comment that was added later`,
      oldStr: `apiVersion: v2
name: wordpress
version: 1.0.0
description: A chart for WordPress deployment on Kubernetes`,
      newStr: `apiVersion: v2
name: wordpress
version: 2.0.0
description: Updated chart`,
      wantContent: `# Header comment
apiVersion: v2
name: wordpress
version: 2.0.0
description: Updated chart
# This is a footer comment that was added later`,
      wantSuccess: true, // exact match succeeds because oldStr is substring of content
    },
    {
      name: 'Real world success - Chart.yaml dependencies',
      content:
        'dependencies:\n- condition: ingress-nginx.enabled\n  name: ingress-nginx\n  repository: https://kubernetes.github.io/ingress-nginx\n  version: 4.12.0\n- alias: okteto-nginx\n  condition: okteto-nginx.enabled\n  name: ingress-nginx\n  repository: https://kubernetes.github.io/ingress-nginx\n  version: 4.12.0',
      oldStr:
        'dependencies:\n- condition: ingress-nginx.enabled\n  name: ingress-nginx\n  repository: https://kubernetes.github.io/ingress-nginx\n  version: 4.12.0\n- alias: okteto-nginx\n  condition: okteto-nginx.enabled\n  name: ingress-nginx\n  repository: https://kubernetes.github.io/ingress-nginx\n  version: 4.12.0',
      newStr:
        'dependencies:\n- condition: traefik.enabled\n  name: traefik\n  repository: https://helm.traefik.io/traefik\n  version: 23.1.0\n- alias: okteto-traefik\n  condition: okteto-traefik.enabled\n  name: traefik\n  repository: https://helm.traefik.io/traefik\n  version: 23.1.0',
      wantContent:
        'dependencies:\n- condition: traefik.enabled\n  name: traefik\n  repository: https://helm.traefik.io/traefik\n  version: 23.1.0\n- alias: okteto-traefik\n  condition: okteto-traefik.enabled\n  name: traefik\n  repository: https://helm.traefik.io/traefik\n  version: 23.1.0',
      wantSuccess: true,
    },
    {
      name: 'Real world fuzzy match - replace ingress-nginx with traefik config',
      content: `ingress-nginx:
  enabled: true
  controller:
    enableAnnotationValidations: false
    image:
      chroot: true
      registry: docker.io
      image: okteto/ingress-nginx
      tag: 1.29.0-rc.2
      digestChroot: ""
    allowSnippetAnnotations: true
    admissionWebhooks:
      enabled: false
      namespaceSelector:
        matchLabels:
          dev.okteto.com: "true"
    replicaCount: 2
    affinity:
      nodeAffinity:
        preferredDuringSchedulingIgnoredDuringExecution:
          - preference:
              matchExpressions:
                - key: dev.okteto.com/overloaded
                  operator: DoesNotExist
            weight: 50
      podAntiAffinity:
        preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                  - key: app.kubernetes.io/component
                    operator: In
                    values:
                      - controller
                  - key: app.kubernetes.io/name
                    operator: In
                    values:
                      - ingress-nginx
              topologyKey: kubernetes.io/hostname
    config:
      annotation-value-word-blocklist: load_module,lua_package,_by_lua,root,serviceaccount
      log-format-escape-json: "true"
      log-format-upstream: '{"time": "$time_iso8601", "remote_addr": "$remote_addr", "x_forward_for": "$proxy_add_x_forwarded_for", "request_id": "$req_id", "remote_user": "$remote_user", "bytes_sent": $bytes_sent, "request_time": $request_time, "status": $status, "vhost": "$host", "request_proto": "$server_protocol", "path": "$uri", "request_query": "$args", "request_length": $request_length, "duration": $request_time,"method": "$request_method", "http_referrer": "$http_referer", "http_user_agent": "$http_user_agent" }'
      ignore-invalid-headers: "false"
      enable-underscores-in-headers: "true"
      proxy-buffer-size: 64K
      allow-cross-namespace-resources: "true"
      strict-validate-path-type: "false"
      ssl-ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:AES128-GCM-SHA256:AES128-GCM-SHA384"
    extraArgs:
      default-ssl-certificate: $(POD_NAMESPACE)/default-ssl-certificate-selfsigned
      default-backend-service: $(POD_NAMESPACE)/$(OKTETO_INGRESS_NGINX_DEFAULT_BACKEND)
    service:
      externalTrafficPolicy: Local
      type: LoadBalancer
    ingressClass: okteto-controlplane-nginx
    ingressClassResource:
      name: okteto-controlplane-nginx
      enabled: true
      default: false
      controllerValue: "k8s.io/okteto-controlplane-nginx"
    extraEnvs:
      - name: OKTETO_INGRESS_NGINX_DEFAULT_BACKEND
        valueFrom:
          configMapKeyRef:
            key: defaultbackendservice
            name: okteto-ingress-config
    priorityClassName:
  defaultBackend:
    enabled: false`,
      oldStr: `ingress-nginx:
  enabled: true
  controller:
    enableAnnotationValidations: false
    image:
      chroot: true
      registry: docker.io
      image: okteto/ingress-nginx
      tag: 1.29.0-rc.2
      digestChroot: ""
    allowSnippetAnnotations: true
    admissionWebhooks:
      enabled: false
      namespaceSelector:
        matchLabels:
          dev.okteto.com: "true"
    replicaCount: 2
    affinity:
      nodeAffinity:
        preferredDuringSchedulingIgnoredDuringExecution:
          - preference:
              matchExpressions:
                - key: dev.okteto.com/overloaded
                  operator: DoesNotExist
            weight: 50
      podAntiAffinity:
        preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                  - key: app.kubernetes.io/component
                    operator: In
                    values:
                      - controller
                  - key: app.kubernetes.io/name
                    operator: In
                    values:
                      - ingress-nginx
              topologyKey: kubernetes.io/hostname
    config:
      annotation-value-word-blocklist: load_module,lua_package,_by_lua,root,serviceaccount
      log-format-escape-json: "true"
      log-format-upstream: '{"time": "$time_iso8601", "remote_addr": "$remote_addr", "x_forward_for": "$proxy_add_x_forwarded_for", "request_id": "$req_id", "remote_user": "$remote_user", "bytes_sent": $bytes_sent, "request_time": $request_time, "status": $status, "vhost": "$host", "request_proto": "$server_protocol", "path": "$uri", "request_query": "$args", "request_length": $request_length, "duration": $request_time,"method": "$request_method", "http_referrer": "$http_referer", "http_user_agent": "$http_user_agent" }'
      ignore-invalid-headers: "false"
      enable-underscores-in-headers: "true"
      proxy-buffer-size: 64K
      allow-cross-namespace-resources: "true"
      strict-validate-path-type: "false"
      ssl-ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:AES128-GCM-SHA256:AES128-GCM-SHA384"
    extraArgs:
      default-ssl-certificate: $(POD_NAMESPACE)/default-ssl-certificate-selfsigned
      default-backend-service: $(POD_NAMESPACE)/$(OKTETO_INGRESS_NGINX_DEFAULT_BACKEND)
    service:
      externalTrafficPolicy: Local
      type: LoadBalancer
    ingressClass: okteto-controlplane-nginx
    ingressClassResource:
      name: okteto-controlplane-nginx
      enabled: true
      default: false
      controllerValue: "k8s.io/okteto-controlplane-nginx"
    extraEnvs:
      - name: OKTETO_INGRESS_NGINX_DEFAULT_BACKEND
        valueFrom:
          configMapKeyRef:
            key: defaultbackendservice
            name: okteto-ingress-config
    priorityClassName:
  defaultBackend:
    enabled: false`,
      newStr: `traefik:
  enabled: true
  ingressClass: okteto-controlplane-traefik`,
      wantContent: `traefik:
  enabled: true
  ingressClass: okteto-controlplane-traefik`,
      wantSuccess: true,
    },
  ];

  test.each(tests)('$name', ({ content, oldStr, newStr, wantContent, wantSuccess, wantErrContent }) => {
    const result = performStringReplacement(content, oldStr, newStr);

    // Check success flag
    expect(result.success).toBe(wantSuccess);

    // Check content
    expect(result.content).toBe(wantContent);

    // Check error
    if (wantSuccess) {
      expect(result.error).toBeUndefined();
    } else if (wantErrContent) {
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe(wantErrContent);
    }
  });
});
