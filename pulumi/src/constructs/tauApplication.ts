import * as pulumi from "@pulumi/pulumi";

export abstract class TauApplication extends pulumi.ComponentResource {
  public readonly labels: { app: string };

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    const labels = { app: name };
    const transformation: pulumi.ResourceTransformation = (args) => {
      if (args.type.startsWith("kubernetes:")) {
        return {
          props: {
            ...args.props,
            metadata: {
              ...args.props.metadata,
              labels: {
                ...labels,
                ...args.props.metadata?.labels,
              },
            },
          },
          opts: args.opts,
        };
      }
      return undefined;
    };

    super("TauApplication", name, {}, {
      ...opts,
      transformations: [...(opts?.transformations || []), transformation],
    });
    
    this.labels = labels;
  }
}